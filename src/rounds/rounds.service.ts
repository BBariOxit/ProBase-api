import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GroupMemberStatus,
  Prisma,
  RegistrationGroupStatus,
  Role,
  RoundPhase,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ExtendRoundDto } from './dto/extend-round.dto';
import { QueryRoundsDto } from './dto/query-rounds.dto';
import { SetSemesterRoundsDto } from './dto/set-semester-rounds.dto';
import { UpdateRoundDto } from './dto/update-round.dto';
import { RoundPhaseService } from './round-phase.service';

const ROUND_SELECT = {
  id: true,
  semesterId: true,
  projectTypeId: true,
  registrationStart: true,
  registrationEnd: true,
  phase: true,
  allocationMode: true,
  finalisedAt: true,
  semester: { select: { id: true, name: true, code: true } },
  projectType: { select: { id: true, name: true, code: true } },
  eligibilities: {
    select: { cohort: true },
    orderBy: { cohort: 'asc' },
  },
} satisfies Prisma.RegistrationRoundSelect;

type RoundRow = Prisma.RegistrationRoundGetPayload<{
  select: typeof ROUND_SELECT;
}>;

/**
 * The phases in which the schedule is still a schedule.
 *
 * Past these, moving the closing date is not an edit but a reopening, and it has
 * to go through `extend` — where it acquires an author, a reason and a log
 * entry. Silently accepting the edit here would be the worst of the options: it
 * either does nothing while the caller believes they have extended the round, or
 * it reopens a gate with no record of who did it.
 */
const SCHEDULE_EDITABLE_PHASES: readonly RoundPhase[] = [
  RoundPhase.PREP,
  RoundPhase.OPEN,
];

@Injectable()
export class RoundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phases: RoundPhaseService,
  ) {}

  // ── read ──────────────────────────────────────────────────

  async findAll(query: QueryRoundsDto, userId: number, role: Role) {
    const where: Prisma.RegistrationRoundWhereInput = {};

    if (query.semesterId) where.semesterId = query.semesterId;
    if (query.projectTypeId) where.projectTypeId = query.projectTypeId;

    // `mine` is a student's question. Staff run the rounds, so narrowing their
    // view to an intake they do not have would just hide the list from the
    // people who maintain it.
    const scopedToMe = query.mine && role === Role.STUDENT;

    if (scopedToMe) {
      where.id = { in: await this.eligibleRoundIds(userId) };
    }

    const rounds = await this.prisma.registrationRound.findMany({
      where,
      select: ROUND_SELECT,
      orderBy: [{ semesterId: 'desc' }, { registrationEnd: 'asc' }],
    });

    const rendered = await this.renderMany(rounds);

    return scopedToMe ? this.ownRoundFirst(rendered, userId) : rendered;
  }

  async findOne(id: number) {
    const round = await this.prisma.registrationRound.findUnique({
      where: { id },
      select: ROUND_SELECT,
    });

    if (!round) throw new NotFoundException(`Round ${id} not found`);

    return (await this.renderMany([round]))[0];
  }

  /** Every round of one semester — the faculty's plan for that term. */
  async findForSemester(semesterId: number) {
    await this.requireSemester(semesterId);

    const rounds = await this.prisma.registrationRound.findMany({
      where: { semesterId },
      select: ROUND_SELECT,
      orderBy: { projectTypeId: 'asc' },
    });

    return this.renderMany(rounds);
  }

  /**
   * The kinds of project this particular caller may take in a semester.
   *
   * What the browse screen needs to default its filter to. Staff have no intake,
   * so they see everything — the rule exists to steer students, not to hide the
   * catalogue from the people running it.
   */
  async findEligibleProjectTypes(
    semesterId: number,
    userId: number,
    role: Role,
  ) {
    await this.requireSemester(semesterId);

    if (role !== Role.STUDENT) {
      return this.prisma.projectType.findMany({ orderBy: { code: 'asc' } });
    }

    const cohort = await this.cohortOf(userId);

    // No profile or no intake year means nothing can be said about eligibility,
    // and an empty list is the honest answer — not the whole catalogue.
    if (!cohort) return [];

    const rounds = await this.prisma.registrationRound.findMany({
      where: { semesterId, eligibilities: { some: { cohort } } },
      select: { projectType: { select: { id: true, name: true, code: true } } },
      orderBy: { projectType: { code: 'asc' } },
    });

    return rounds.map((round) => round.projectType);
  }

  /**
   * The rounds this caller's intake may take part in, as ids.
   *
   * Fails closed: an account with no intake on file, or an office that has not
   * declared anything yet, gets an empty list rather than everything. The filter
   * exists to show a student what is actually theirs, and guessing generously
   * here would defeat it.
   */
  async eligibleRoundIds(userId: number, semesterIds?: number[]) {
    const cohort = await this.cohortOf(userId);
    if (!cohort) return [];

    const rows = await this.prisma.roundEligibility.findMany({
      where: {
        cohort,
        ...(semesterIds && { round: { semesterId: { in: semesterIds } } }),
      },
      select: { roundId: true },
    });

    return rows.map((row) => row.roundId);
  }

  /**
   * The round a topic of this kind belongs to in this semester.
   *
   * A lecturer choosing a kind of project *is* choosing the round, so there is
   * no separate field for it — and writing a topic for something the faculty has
   * not opened is refused here rather than left to sit in the catalogue, where
   * every student pressing register would be turned away for a reason that has
   * nothing to do with them.
   */
  async requireRoundFor(semesterId: number, projectTypeId: number) {
    const round = await this.prisma.registrationRound.findUnique({
      where: { semesterId_projectTypeId: { semesterId, projectTypeId } },
      select: { id: true },
    });

    if (!round) {
      throw new ConflictException(
        'The faculty office has not opened a round for this kind of project this semester, so no topic can be written for it',
      );
    }

    return round;
  }

  // ── write ─────────────────────────────────────────────────

  /**
   * Replaces a semester's registration plan wholesale.
   *
   * Declaring an intake is what creates a round, so this one call is the whole
   * of "open the semester": the office sends what the rule should be, and
   * working out which rows that implies is this method's job, not theirs.
   */
  async setSemesterRounds(semesterId: number, dto: SetSemesterRoundsDto) {
    await this.requireSemester(semesterId);
    await this.requireProjectTypes(dto.rounds.map((r) => r.projectTypeId));

    const existing = await this.prisma.registrationRound.findMany({
      where: { semesterId },
      select: {
        id: true,
        projectTypeId: true,
        phase: true,
        registrationStart: true,
        registrationEnd: true,
        _count: { select: { topics: true } },
      },
    });

    const phases = await this.phases.resolveMany(existing);
    const byProjectType = new Map(
      existing.map((round) => [round.projectTypeId, round]),
    );
    const kept = new Set(dto.rounds.map((round) => round.projectTypeId));

    // Dropping a round that lecturers have already written topics for would
    // delete their work through an omission in somebody else's payload, so it
    // is refused by name rather than obeyed.
    const dropped = existing.filter((r) => !kept.has(r.projectTypeId));
    const blocked = dropped.filter((round) => round._count.topics > 0);

    if (blocked.length > 0) {
      const types = await this.prisma.projectType.findMany({
        where: { id: { in: blocked.map((round) => round.projectTypeId) } },
        select: { name: true },
      });

      throw new ConflictException(
        `Cannot remove rounds that already carry topics: ${types
          .map((type) => type.name)
          .join(', ')}`,
      );
    }

    for (const plan of dto.rounds) {
      const current = byProjectType.get(plan.projectTypeId);
      if (!current) continue;

      this.assertScheduleEditable(
        phases.get(current.id) ?? current.phase,
        movesWindow(current, plan),
      );
    }

    await this.prisma.$transaction(async (tx) => {
      if (dropped.length > 0) {
        await tx.registrationRound.deleteMany({
          where: { id: { in: dropped.map((round) => round.id) } },
        });
      }

      for (const plan of dto.rounds) {
        const current = byProjectType.get(plan.projectTypeId);

        const saved = current
          ? await tx.registrationRound.update({
              where: { id: current.id },
              data: {
                registrationStart: plan.registrationStart,
                registrationEnd: plan.registrationEnd,
                ...(plan.allocationMode && {
                  allocationMode: plan.allocationMode,
                }),
              },
              select: { id: true },
            })
          : await tx.registrationRound.create({
              data: {
                semesterId,
                projectTypeId: plan.projectTypeId,
                registrationStart: plan.registrationStart,
                registrationEnd: plan.registrationEnd,
                ...(plan.allocationMode && {
                  allocationMode: plan.allocationMode,
                }),
              },
              select: { id: true },
            });

        await this.replaceCohorts(tx, saved.id, plan.cohorts);
      }
    });

    return this.findForSemester(semesterId);
  }

  /** Adjust one round without resending the semester's whole plan. */
  async update(id: number, dto: UpdateRoundDto) {
    const round = await this.loadRow(id);
    const phase = await this.phases.resolve(id);

    const registrationStart = dto.registrationStart ?? round.registrationStart;
    const registrationEnd = dto.registrationEnd ?? round.registrationEnd;

    this.assertScheduleEditable(
      phase,
      movesWindow(round, { registrationStart, registrationEnd }),
    );

    if (registrationEnd <= registrationStart) {
      throw new BadRequestException(
        'Ngày kết thúc đăng ký phải sau ngày mở đăng ký',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.registrationRound.update({
        where: { id },
        data: {
          registrationStart,
          registrationEnd,
          ...(dto.allocationMode && { allocationMode: dto.allocationMode }),
        },
      });

      if (dto.cohorts) await this.replaceCohorts(tx, id, dto.cohorts);
    });

    return this.findOne(id);
  }

  /**
   * Reopen a closed round for the students who ended up without a group.
   *
   * Only from RECONCILING, and only forward in time. The extension is a new
   * `registrationEnd` plus a phase saying which window this is, so it ends by
   * itself — there is no second button to press, and therefore none to forget.
   *
   * Placing students by hand stays shut while it runs (see the faculty office's
   * desk): with the gate open the list of students without a group moves under
   * the hand of whoever is working it.
   */
  async extend(id: number, dto: ExtendRoundDto, userId: number) {
    const round = await this.loadRow(id);
    const phase = await this.phases.resolve(id);

    if (phase !== RoundPhase.RECONCILING) {
      throw new ConflictException(
        phase === RoundPhase.EXTENDED
          ? 'This round is already running an extension'
          : 'Only a round whose gate has closed can be extended',
      );
    }

    if (dto.registrationEnd.getTime() <= Date.now()) {
      throw new BadRequestException(
        'Hạn gia hạn phải nằm ở tương lai, nếu không cổng đóng lại ngay khi vừa mở',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Guarded on the phase rather than a plain update: two administrators
      // pressing at once would otherwise both write, and the second would move
      // the deadline of an extension it believed it was starting.
      const { count } = await tx.registrationRound.updateMany({
        where: { id, phase: RoundPhase.RECONCILING },
        data: {
          phase: RoundPhase.EXTENDED,
          registrationEnd: dto.registrationEnd,
        },
      });

      if (count === 0) {
        throw new ConflictException(
          'This round has just changed state — reload and try again',
        );
      }

      await tx.auditLog.create({
        data: {
          userId,
          action: 'EXTEND_REGISTRATION_ROUND',
          targetTable: 'registration_rounds',
          targetId: String(id),
          oldValue: {
            phase: round.phase,
            registrationEnd: round.registrationEnd.toISOString(),
          },
          newValue: {
            phase: RoundPhase.EXTENDED,
            registrationEnd: dto.registrationEnd.toISOString(),
            // The announced deadline was overridden, and this is the only record
            // of why. It is the reason the reason field is mandatory.
            reason: dto.reason,
          },
        },
      });
    });

    return this.findOne(id);
  }

  // ── internals ─────────────────────────────────────────────

  private assertScheduleEditable(phase: RoundPhase, movesWindow: boolean) {
    if (!movesWindow) return;
    if (SCHEDULE_EDITABLE_PHASES.includes(phase)) return;

    throw new ConflictException(
      'Registration has already closed for this round, so its dates can no longer be edited — extend it instead, which records who reopened it and why',
    );
  }

  private async replaceCohorts(
    tx: Prisma.TransactionClient,
    roundId: number,
    cohorts: string[],
  ) {
    await tx.roundEligibility.deleteMany({ where: { roundId } });
    await tx.roundEligibility.createMany({
      // A spreadsheet paste with a repeated line is accepted rather than
      // rejected on a unique-key violation the caller cannot see.
      data: [...new Set(cohorts)].map((cohort) => ({ roundId, cohort })),
    });
  }

  /**
   * Brings every row's phase up to date before it goes out, so a client cannot
   * be told a round is still OPEN by the very endpoint whose job is to report
   * its state.
   */
  private async renderMany(rounds: RoundRow[]) {
    const phases = await this.phases.resolveMany(rounds);

    return rounds.map(({ eligibilities, ...round }) => ({
      ...round,
      phase: phases.get(round.id) ?? round.phase,
      cohorts: eligibilities.map((rule) => rule.cohort),
    }));
  }

  /**
   * Puts the round the student is actually registered in at the top, and the
   * soonest deadline after it.
   *
   * A student eligible for two rounds has to be shown one of them first, and
   * these two rules are the two answers that are never wrong: the round they
   * have already chosen, or — if they have chosen none — the one they are about
   * to miss.
   */
  private async ownRoundFirst<T extends { id: number; registrationEnd: Date }>(
    rounds: T[],
    userId: number,
  ) {
    if (rounds.length < 2) return rounds;

    const membership = await this.prisma.registrationGroupMember.findFirst({
      where: {
        student: { userId },
        status: GroupMemberStatus.ACCEPTED,
        group: { status: { not: RegistrationGroupStatus.REJECTED } },
      },
      select: { group: { select: { topic: { select: { roundId: true } } } } },
    });

    const ownRoundId = membership?.group.topic.roundId;

    return [...rounds].sort((a, b) => {
      if (a.id === ownRoundId) return -1;
      if (b.id === ownRoundId) return 1;

      return a.registrationEnd.getTime() - b.registrationEnd.getTime();
    });
  }

  private async loadRow(id: number) {
    const round = await this.prisma.registrationRound.findUnique({
      where: { id },
      select: {
        id: true,
        phase: true,
        registrationStart: true,
        registrationEnd: true,
      },
    });

    if (!round) throw new NotFoundException(`Round ${id} not found`);

    return round;
  }

  private async cohortOf(userId: number) {
    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { cohort: true },
    });

    return profile?.cohort ?? null;
  }

  private async requireSemester(id: number) {
    const semester = await this.prisma.semester.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!semester) throw new NotFoundException(`Semester ${id} not found`);
  }

  private async requireProjectTypes(ids: number[]) {
    const wanted = [...new Set(ids)];
    const known = await this.prisma.projectType.findMany({
      where: { id: { in: wanted } },
      select: { id: true },
    });

    if (known.length === wanted.length) return;

    const found = new Set(known.map((type) => type.id));
    const missing = wanted.filter((id) => !found.has(id));

    throw new NotFoundException(`Project type ${missing.join(', ')} not found`);
  }
}

/** Whether a plan actually moves either end of the window. */
function movesWindow(
  current: { registrationStart: Date; registrationEnd: Date },
  plan: { registrationStart: Date; registrationEnd: Date },
): boolean {
  return (
    current.registrationStart.getTime() !== plan.registrationStart.getTime() ||
    current.registrationEnd.getTime() !== plan.registrationEnd.getTime()
  );
}
