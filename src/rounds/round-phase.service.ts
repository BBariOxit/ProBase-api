import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GroupMemberStatus,
  RegistrationGroupStatus,
  RoundPhase,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Reads — and where the calendar says so, advances — a registration round's
 * phase, and answers the two questions every registration action asks of it.
 *
 * Every such action is gated on the phase and nothing else. In particular it is
 * *not* also checked against `registrationStart` / `registrationEnd`: the phase
 * is the truth and the dates are only what moves it, so an office that opened
 * the gate early by moving the start date meant to open it, and a second check
 * against the dates would quietly overrule them.
 */
@Injectable()
export class RoundPhaseService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The phase as of now, moving it along if the calendar says it should have.
   *
   * PREP → OPEN once `registrationStart` has passed, and OPEN → RECONCILING —
   * or EXTENDED → RECONCILING — once `registrationEnd` has. The transitions the
   * calendar can make on its own, and all of them made here rather than on a
   * schedule: a phase that only changes when somebody looks is indistinguishable
   * from one that changes on the stroke of the deadline, because nothing can
   * observe the difference without asking, and asking is what moves it.
   *
   * FINALIZED is deliberately absent, and so is the way into EXTENDED. Ending
   * RECONCILING means someone decided the placement work was done, and starting
   * an extension means someone decided to reopen the gate — no date knows
   * either.
   */
  async resolve(roundId: number): Promise<RoundPhase> {
    const round = await this.load(roundId);

    return this.advance(round);
  }

  /**
   * Throws unless this student may take a topic or join a group in this round.
   *
   * Open in OPEN, and in EXTENDED only for a student who has no group. That
   * asymmetry is the whole of an extension: the gate is shut in RECONCILING so
   * that an allocation being assembled cannot move underneath the person
   * assembling it, and a student with no group is in no allocation to disturb —
   * they are the ones an extension exists for.
   */
  async requireCanJoin(roundId: number, studentId: number): Promise<void> {
    const round = await this.load(roundId);
    const phase = await this.advance(round);

    if (phase === RoundPhase.OPEN) return;

    if (phase === RoundPhase.EXTENDED) {
      // Asked here rather than left to the caller's own "already in a group"
      // check, so the rule that defines this phase lives where the phase does.
      // The two refusals also read differently, and a student in an extension
      // deserves the one that explains why the reopened gate is not for them.
      if (!(await this.hasGroup(studentId, round.semesterId))) return;

      throw new ConflictException(
        'Registration reopened only for students who ended up without a group — yours is unaffected and cannot be changed',
      );
    }

    throw new ConflictException(REFUSAL_BY_PHASE[phase]);
  }

  /**
   * Throws unless a student may still take their own registration apart —
   * leave, disband, hand a member their place back.
   *
   * OPEN and nothing else. An extension deliberately does not reopen this: the
   * placement work of RECONCILING is built on who is in which group, and a
   * member walking out during the extension would break exactly that.
   */
  async requireCanLeave(roundId: number): Promise<void> {
    const phase = await this.resolve(roundId);

    if (phase === RoundPhase.OPEN) return;

    throw new ConflictException(
      phase === RoundPhase.EXTENDED
        ? 'Registration has closed. The extension only lets students without a group register — a group that exists can no longer be changed'
        : REFUSAL_BY_PHASE[phase],
    );
  }

  private async load(roundId: number) {
    const round = await this.prisma.registrationRound.findUnique({
      where: { id: roundId },
      select: {
        id: true,
        semesterId: true,
        phase: true,
        registrationStart: true,
        registrationEnd: true,
      },
    });

    if (!round) {
      throw new NotFoundException(`Registration round ${roundId} not found`);
    }

    return round;
  }

  /**
   * The same answer as `resolve`, for rows the caller has already loaded.
   *
   * A list endpoint holds everything the calculation needs — the phase and both
   * dates are on the row — so re-reading each round one at a time would be a
   * query per row to learn what is already in hand.
   */
  async resolveMany<T extends PhaseRow>(
    rounds: T[],
  ): Promise<Map<number, RoundPhase>> {
    const current = new Map<number, RoundPhase>();
    const moved: { id: number; from: RoundPhase; to: RoundPhase }[] = [];

    for (const round of rounds) {
      const due = duePhase(round);
      current.set(round.id, due);

      if (due !== round.phase) {
        moved.push({ id: round.id, from: round.phase, to: due });
      }
    }

    // Guarded on the phase that was read rather than a plain update, so two
    // requests arriving together cannot fight: the second matches no rows and
    // does nothing, instead of writing over a phase that has since moved on.
    await Promise.all(
      moved.map((move) =>
        this.prisma.registrationRound.updateMany({
          where: { id: move.id, phase: move.from },
          data: { phase: move.to },
        }),
      ),
    );

    return current;
  }

  private async advance(round: PhaseRow): Promise<RoundPhase> {
    const phases = await this.resolveMany([round]);

    return phases.get(round.id) ?? round.phase;
  }

  private async hasGroup(studentId: number, semesterId: number) {
    const membership = await this.prisma.registrationGroupMember.findFirst({
      where: {
        studentId,
        semesterId,
        status: GroupMemberStatus.ACCEPTED,
        group: { status: { not: RegistrationGroupStatus.REJECTED } },
      },
      select: { id: true },
    });

    return membership !== null;
  }
}

/** Everything the phase calculation needs, and nothing else. */
interface PhaseRow {
  id: number;
  phase: RoundPhase;
  registrationStart: Date;
  registrationEnd: Date;
}

/**
 * The phase the calendar implies, given the one on record.
 *
 * Only ever moves forward, and only out of the phases a date can leave.
 * RECONCILING and FINALIZED are returned unchanged: once the office is placing
 * students, or has finished, no date may undo that — a `registrationEnd` edited
 * to next week must not reopen a round whose allocation is being settled, which
 * is why reopening is a command with an author rather than a date.
 *
 * EXTENDED leaves on the same comparison as OPEN because an extension *is* a new
 * `registrationEnd`: the column moves forward and the phase records that the
 * window it describes is the second one. One date, one comparison, and no way
 * for an extension to outlive the deadline it was given.
 */
export function duePhase(round: {
  phase: RoundPhase;
  registrationStart: Date;
  registrationEnd: Date;
}): RoundPhase {
  const now = Date.now();

  if (round.phase === RoundPhase.PREP) {
    if (now > round.registrationEnd.getTime()) {
      return RoundPhase.RECONCILING;
    }

    return now >= round.registrationStart.getTime()
      ? RoundPhase.OPEN
      : RoundPhase.PREP;
  }

  if (round.phase === RoundPhase.OPEN || round.phase === RoundPhase.EXTENDED) {
    return now > round.registrationEnd.getTime()
      ? RoundPhase.RECONCILING
      : round.phase;
  }

  return round.phase;
}

/**
 * Why a round is refused, named by phase.
 *
 * The message names the situation rather than saying "you cannot do that",
 * because the gate having closed and the gate not having opened yet call for
 * opposite reactions from the person reading it.
 */
const REFUSAL_BY_PHASE: Record<
  Exclude<RoundPhase, 'OPEN' | 'EXTENDED'>,
  string
> = {
  [RoundPhase.PREP]:
    'Registration for this round has not opened yet — no topic can be taken while the faculty office is still preparing',
  [RoundPhase.RECONCILING]:
    'Registration has closed. The faculty office is placing the students who ended up without a group, so groups can no longer be changed',
  [RoundPhase.FINALIZED]:
    'Allocation for this round is final and can no longer be changed',
};
