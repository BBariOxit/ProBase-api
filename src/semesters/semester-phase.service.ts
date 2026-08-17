import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SemesterPhase } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Reads — and where the calendar says so, advances — a semester's phase.
 *
 * Every registration action is gated on the phase and nothing else. In
 * particular it is *not* also checked against `registrationStart` /
 * `registrationEnd`: the phase is the truth and the dates are only what moves
 * it, so an office that opens the gate early by setting the phase means to have
 * opened it, and a second check against the dates would quietly overrule them.
 */
@Injectable()
export class SemesterPhaseService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The phase as of now, moving it along if the calendar says it should have.
   *
   * PREP → OPEN once `registrationStart` has passed, and OPEN → RECONCILING once
   * `registrationEnd` has. The two transitions the calendar can make on its own,
   * and both are made here rather than on a schedule: a phase that only changes
   * when somebody looks is indistinguishable from one that changes on the stroke
   * of the deadline, because nothing can observe the difference without asking,
   * and asking is what moves it.
   *
   * FINALIZED is deliberately absent. Ending RECONCILING means someone decided
   * the placement work was done, and no date knows that.
   */
  async resolve(semesterId: number): Promise<SemesterPhase> {
    const semester = await this.prisma.semester.findUnique({
      where: { id: semesterId },
      select: { phase: true, registrationStart: true, registrationEnd: true },
    });

    if (!semester) {
      throw new NotFoundException(`Semester ${semesterId} not found`);
    }

    const due = duePhase(semester);
    if (due === semester.phase) return semester.phase;

    // Guarded on the phase we read rather than a plain update, so two requests
    // arriving together cannot fight: the second matches no rows and does
    // nothing, instead of writing over a phase that has since moved on.
    await this.prisma.semester.updateMany({
      where: { id: semesterId, phase: semester.phase },
      data: { phase: due },
    });

    return due;
  }

  /**
   * Throws unless students may still change their own registration.
   *
   * The message names the phase, because "you cannot do that" without saying
   * why leaves a student refreshing the page: the gate having closed and the
   * gate not having opened yet call for opposite reactions.
   */
  async requireOpen(semesterId: number): Promise<void> {
    const phase = await this.resolve(semesterId);

    if (phase === SemesterPhase.OPEN) return;

    throw new ConflictException(REFUSAL_BY_PHASE[phase]);
  }
}

/**
 * The phase the calendar implies, given the one on record.
 *
 * Only ever moves forward, and only out of the two phases a date can leave.
 * RECONCILING and FINALIZED are returned unchanged: once the office is placing
 * students, or has finished, no date may undo that — a `registrationEnd` edited
 * to next week must not reopen a semester whose allocation is being settled.
 */
function duePhase(semester: {
  phase: SemesterPhase;
  registrationStart: Date;
  registrationEnd: Date;
}): SemesterPhase {
  const now = Date.now();

  if (semester.phase === SemesterPhase.PREP) {
    if (now > semester.registrationEnd.getTime()) {
      return SemesterPhase.RECONCILING;
    }

    return now >= semester.registrationStart.getTime()
      ? SemesterPhase.OPEN
      : SemesterPhase.PREP;
  }

  if (semester.phase === SemesterPhase.OPEN) {
    return now > semester.registrationEnd.getTime()
      ? SemesterPhase.RECONCILING
      : SemesterPhase.OPEN;
  }

  return semester.phase;
}

const REFUSAL_BY_PHASE: Record<Exclude<SemesterPhase, 'OPEN'>, string> = {
  [SemesterPhase.PREP]:
    'Registration for this semester has not opened yet — no topic can be taken while the faculty office is still preparing',
  [SemesterPhase.RECONCILING]:
    'Registration has closed. The faculty office is placing the students who ended up without a group, so groups can no longer be changed',
  [SemesterPhase.FINALIZED]:
    'Allocation for this semester is final and can no longer be changed',
};
