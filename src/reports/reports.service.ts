import { Injectable, NotFoundException } from '@nestjs/common';
import {
  GroupJoinSource,
  GroupMemberStatus,
  RegistrationGroupStatus,
  RoundPhase,
  SubmissionType,
  TopicStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RoundPhaseService } from '../rounds/round-phase.service';
import { StudentRosterService } from '../students/student-roster.service';

/** How one round of the term went, in the numbers the faculty asks for. */
export interface RoundReport {
  roundId: number;
  projectType: { id: number; name: string; code: string };
  phase: RoundPhase;
  cohorts: string[];
  /** Students of this round's intakes, on active accounts. */
  eligible: number;
  withGroup: number;
  withoutGroup: number;
  /** Chose their own topic, whether from the list or through a join link. */
  selfRegistered: number;
  /** Put on a topic by the faculty office during RECONCILING. */
  assigned: number;
  topics: number;
  topicsUnderway: number;
}

/** How much supervising one lecturer took on this term. */
export interface SupervisionReport {
  lecturerId: number;
  fullName: string;
  academicTitle: string | null;
  groups: number;
  students: number;
}

/** How one major's students are placed. */
export interface MajorReport {
  majorId: number;
  name: string;
  code: string;
  students: number;
  withGroup: number;
}

/** How far one round's groups have got with handing work in. */
export interface ProgressReport {
  roundId: number;
  projectType: { id: number; name: string; code: string };
  groups: number;
  midtermSubmitted: number;
  finalSubmitted: number;
  /** Groups whose newest submission has not been answered by their supervisor. */
  awaitingFeedback: number;
}

export interface FacultyReport {
  semester: { id: number; name: string; code: string };
  rounds: RoundReport[];
  supervision: SupervisionReport[];
  majors: MajorReport[];
  progress: ProgressReport[];
}

/** A membership that still counts: accepted, in a group nobody turned down. */
const LIVE_MEMBERSHIP = {
  status: GroupMemberStatus.ACCEPTED,
  group: { status: { not: RegistrationGroupStatus.REJECTED } },
};

/**
 * The term in numbers, for the faculty office.
 *
 * Three questions, and they are not the same question at three scopes. How the
 * registration went is asked **per round** and never summed: a semester runs Cơ
 * sở, Chuyên ngành and Tốt nghiệp side by side for three different intakes,
 * sharing no seat, so "42% xếp tay in học kỳ 1" adds numbers that cannot be
 * added and hides the one round that went badly. How the supervising is spread
 * is asked **per term**, because a lecturer taking two groups in two rounds is
 * carrying two groups. And what has been handed in is per round again, because
 * the deadlines are.
 *
 * Nothing here counts grades. Marking does not exist yet, and a report that
 * printed a column of empty cells would be worse than one that does not offer
 * it: it would look like every student had no grade rather than like the
 * question had not been asked.
 *
 * The whole thing is one read of six queries rather than one per row. That
 * matters less for the milliseconds than for the arithmetic — every number below
 * is counted from the same snapshot, so two of them can never disagree about how
 * many students there are.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phases: RoundPhaseService,
    private readonly roster: StudentRosterService,
  ) {}

  async summary(semesterId?: number): Promise<FacultyReport> {
    const semester = await this.requireSemester(semesterId);

    const rounds = await this.prisma.registrationRound.findMany({
      where: { semesterId: semester.id },
      select: {
        id: true,
        semesterId: true,
        phase: true,
        registrationStart: true,
        registrationEnd: true,
        projectType: { select: { id: true, name: true, code: true } },
        eligibilities: { select: { cohort: true }, orderBy: { cohort: 'asc' } },
      },
      orderBy: { projectTypeId: 'asc' },
    });

    const [phases, memberships, groups, topics, majors, submissions] =
      await Promise.all([
        this.phases.resolveMany(rounds),
        this.memberships(semester.id),
        this.groups(semester.id),
        this.topicCounts(semester.id),
        this.majorTotals(),
        this.submissions(semester.id),
      ]);

    return {
      semester,
      rounds: await this.registrationRows(rounds, phases, memberships, topics),
      supervision: await this.supervisionRows(groups, memberships),
      majors: this.majorRows(majors, memberships),
      progress: this.progressRows(rounds, groups, submissions),
    };
  }

  // ── the three sections ────────────────────────────────────

  /**
   * One row per round: who it covered, how many of them found a topic, and how
   * many of those the office had to place by hand.
   *
   * That last pair is the number the faculty asks for every year, and the only
   * real measure of whether letting students choose is working.
   */
  private async registrationRows(
    rounds: RoundRow[],
    phases: Map<number, RoundPhase>,
    memberships: Membership[],
    topics: Map<number, { total: number; underway: number }>,
  ): Promise<RoundReport[]> {
    return Promise.all(
      rounds.map(async (round) => {
        const cohorts = round.eligibilities.map((rule) => rule.cohort);

        // Asked of the shared roster rather than counted here, so "has a topic"
        // means the same thing on this screen as it does on the faculty list and
        // the allocation desk.
        const [eligible, withGroup] = await Promise.all([
          this.roster.count({ cohorts }),
          this.roster.count({
            semesterId: round.semesterId,
            cohorts,
            hasGroup: true,
          }),
        ]);

        const inRound = memberships.filter(
          (member) => member.roundId === round.id,
        );
        const seats = topics.get(round.id) ?? { total: 0, underway: 0 };

        return {
          roundId: round.id,
          projectType: round.projectType,
          phase: phases.get(round.id) ?? round.phase,
          cohorts,
          eligible,
          withGroup,
          withoutGroup: Math.max(0, eligible - withGroup),
          selfRegistered: inRound.filter(
            (member) => member.joinSource !== GroupJoinSource.ASSIGNED,
          ).length,
          assigned: inRound.filter(
            (member) => member.joinSource === GroupJoinSource.ASSIGNED,
          ).length,
          topics: seats.total,
          topicsUnderway: seats.underway,
        };
      }),
    );
  }

  /**
   * Every lecturer supervising anything this term, busiest first.
   *
   * Groups and students are both reported because they are different loads: two
   * groups of one is two topics to read and two sets of meetings, where one group
   * of four is one of each.
   *
   * Lecturers supervising nothing are left out. A directory of the whole faculty
   * is a different screen, and padding this one with zeroes would bury the row
   * somebody opened it to find.
   */
  private async supervisionRows(
    groups: GroupRow[],
    memberships: Membership[],
  ): Promise<SupervisionReport[]> {
    const groupsBy = tally(groups.map((group) => group.lecturerId));
    const studentsBy = tally(memberships.map((member) => member.lecturerId));

    const ids = [...groupsBy.keys()];
    if (ids.length === 0) return [];

    const lecturers = await this.prisma.lecturerProfile.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true, academicTitle: true },
    });

    return lecturers
      .map((lecturer) => ({
        lecturerId: lecturer.id,
        fullName: lecturer.fullName,
        academicTitle: lecturer.academicTitle,
        groups: groupsBy.get(lecturer.id) ?? 0,
        students: studentsBy.get(lecturer.id) ?? 0,
      }))
      .sort(
        (a, b) =>
          b.students - a.students || a.fullName.localeCompare(b.fullName),
      );
  }

  /**
   * Students per major, and how many of them hold a topic this term.
   *
   * The totals count every active student of that major rather than only those
   * an open round covers, because the question this answers is about the shape
   * of the faculty — and a major that appears small only because its intake is
   * not doing a project this term would answer it wrongly.
   */
  private majorRows(
    majors: MajorTotal[],
    memberships: Membership[],
  ): MajorReport[] {
    const placed = tally(
      memberships.flatMap((member) =>
        member.majorId === null ? [] : [member.majorId],
      ),
    );

    return majors
      .map((major) => ({
        majorId: major.id,
        name: major.name,
        code: major.code,
        students: major.students,
        withGroup: placed.get(major.id) ?? 0,
      }))
      .sort((a, b) => b.students - a.students);
  }

  /**
   * What each round's groups have handed in.
   *
   * `awaitingFeedback` counts the newest version of each kind only. Every
   * earlier version has been superseded by the group itself, and counting those
   * would send the office chasing supervisors over files nobody is waiting on.
   */
  private progressRows(
    rounds: RoundRow[],
    groups: GroupRow[],
    submissions: SubmissionRow[],
  ): ProgressReport[] {
    const newest = newestPerGroupAndType(submissions);

    return rounds.map((round) => {
      const ids = new Set(
        groups
          .filter((group) => group.roundId === round.id)
          .map((group) => group.id),
      );
      const mine = newest.filter((row) => ids.has(row.groupId));

      return {
        roundId: round.id,
        projectType: round.projectType,
        groups: ids.size,
        midtermSubmitted: countGroups(mine, SubmissionType.MIDTERM),
        finalSubmitted: countGroups(mine, SubmissionType.FINAL),
        awaitingFeedback: new Set(
          mine
            .filter((row) => row.feedbackAt === null)
            .map((row) => row.groupId),
        ).size,
      };
    });
  }

  // ── the reads ─────────────────────────────────────────────

  /**
   * Every live membership of the term, carrying the three facts every section
   * counts it by: which round it sits in, whose topic, and the student's major.
   *
   * One query rather than three, so the same rows produce the placement split,
   * the supervision load and the per-major totals — and no two of those can
   * report a different number of students.
   */
  private async memberships(semesterId: number): Promise<Membership[]> {
    const rows = await this.prisma.registrationGroupMember.findMany({
      where: { semesterId, ...LIVE_MEMBERSHIP },
      select: {
        joinSource: true,
        student: { select: { majorId: true } },
        group: {
          select: { topic: { select: { roundId: true, lecturerId: true } } },
        },
      },
    });

    return rows.map((row) => ({
      joinSource: row.joinSource,
      majorId: row.student.majorId,
      roundId: row.group.topic.roundId,
      lecturerId: row.group.topic.lecturerId,
    }));
  }

  private async groups(semesterId: number): Promise<GroupRow[]> {
    const rows = await this.prisma.registrationGroup.findMany({
      where: { semesterId, status: { not: RegistrationGroupStatus.REJECTED } },
      select: {
        id: true,
        topic: { select: { roundId: true, lecturerId: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      roundId: row.topic.roundId,
      lecturerId: row.topic.lecturerId,
    }));
  }

  /** Topics per round, and how many of them a settled round set running. */
  private async topicCounts(semesterId: number) {
    const rows = await this.prisma.topic.groupBy({
      by: ['roundId', 'status'],
      where: { semesterId },
      _count: { _all: true },
    });

    const counts = new Map<number, { total: number; underway: number }>();

    for (const row of rows) {
      const entry = counts.get(row.roundId) ?? { total: 0, underway: 0 };

      entry.total += row._count._all;
      if (row.status === TopicStatus.IN_PROGRESS) {
        entry.underway += row._count._all;
      }

      counts.set(row.roundId, entry);
    }

    return counts;
  }

  /** Active students per major, across the whole faculty. */
  private async majorTotals(): Promise<MajorTotal[]> {
    const [majors, counts] = await Promise.all([
      this.prisma.major.findMany({
        select: { id: true, name: true, code: true },
      }),
      this.prisma.studentProfile.groupBy({
        by: ['majorId'],
        where: { user: { isActive: true } },
        _count: { _all: true },
      }),
    ]);

    const byMajor = new Map(
      counts.map((row) => [row.majorId, row._count._all]),
    );

    return majors.map((major) => ({
      ...major,
      students: byMajor.get(major.id) ?? 0,
    }));
  }

  private async submissions(semesterId: number): Promise<SubmissionRow[]> {
    return this.prisma.submission.findMany({
      where: {
        group: {
          semesterId,
          status: { not: RegistrationGroupStatus.REJECTED },
        },
      },
      select: {
        groupId: true,
        submissionType: true,
        version: true,
        feedbackAt: true,
      },
    });
  }

  /**
   * The term being reported on: the one asked for, or the one the faculty
   * currently has open.
   */
  private async requireSemester(semesterId?: number) {
    const semester = semesterId
      ? await this.prisma.semester.findUnique({
          where: { id: semesterId },
          select: { id: true, name: true, code: true },
        })
      : await this.prisma.semester.findFirst({
          where: { isActive: true },
          select: { id: true, name: true, code: true },
        });

    if (!semester) {
      throw new NotFoundException(
        semesterId
          ? `Không tìm thấy học kỳ ${semesterId}`
          : 'Khoa chưa mở học kỳ nào, nên chưa có gì để thống kê.',
      );
    }

    return semester;
  }
}

// ── shapes the sections above are counted from ──────────────

type RoundRow = {
  id: number;
  semesterId: number;
  phase: RoundPhase;
  registrationStart: Date;
  registrationEnd: Date;
  projectType: { id: number; name: string; code: string };
  eligibilities: { cohort: string }[];
};

interface Membership {
  joinSource: GroupJoinSource;
  majorId: number | null;
  roundId: number;
  lecturerId: number;
}

interface GroupRow {
  id: number;
  roundId: number;
  lecturerId: number;
}

interface MajorTotal {
  id: number;
  name: string;
  code: string;
  students: number;
}

interface SubmissionRow {
  groupId: number;
  submissionType: SubmissionType;
  version: number;
  feedbackAt: Date | null;
}

/** How many times each value appears. */
function tally(values: number[]): Map<number, number> {
  const counts = new Map<number, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return counts;
}

/**
 * The latest version of each kind of report from each group.
 *
 * Nothing is ever overwritten here — re-submitting writes a new row one version
 * higher — so counting rows would count a diligent group three times and report
 * their supervisor as three answers behind.
 */
function newestPerGroupAndType(rows: SubmissionRow[]): SubmissionRow[] {
  const newest = new Map<string, SubmissionRow>();

  for (const row of rows) {
    const key = `${row.groupId}:${row.submissionType}`;
    const held = newest.get(key);

    if (!held || row.version > held.version) newest.set(key, row);
  }

  return [...newest.values()];
}

function countGroups(rows: SubmissionRow[], kind: SubmissionType): number {
  return rows.filter((row) => row.submissionType === kind).length;
}
