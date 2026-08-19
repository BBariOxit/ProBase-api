import { ConflictException, Injectable } from '@nestjs/common';
import {
  RegistrationGroupStatus,
  RoundPhase,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * How much supervising a lecturer has taken on this term, and whether the
 * faculty's ceiling leaves room for one more.
 *
 * `groups` is the number they would arrive at by counting on their fingers, and
 * it is the one shown on a screen. `reserved` is the part they would forget: a
 * proposal they said yes to becomes a topic held for that one student, who has
 * not registered yet — the group does not exist, but the promise does. Counting
 * only the groups is what would let somebody at their limit accept five
 * proposals in an afternoon, because none of them has turned into a group by the
 * time the next one is answered.
 */
export interface MentoringLoad {
  /** Live groups on this lecturer's topics this semester. */
  groups: number;
  /** Topics accepted from a proposal that the proposer has yet to register on. */
  reserved: number;
  /** The faculty's ceiling, or null when they set none. */
  quota: number | null;
  /** Whether `groups + reserved` has reached that ceiling. */
  atQuota: boolean;
}

/** As much of a lecturer as counting their load needs. */
interface Quota {
  id: number;
  maxMentoringQuota: number | null;
}

/** Rounds whose gate a reserved topic could still be walked through. */
const OPEN_ENOUGH_TO_HOLD = [
  RoundPhase.PREP,
  RoundPhase.OPEN,
  RoundPhase.EXTENDED,
] as const;

@Injectable()
export class MentoringLoadService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The load carried by each of several lecturers, in two queries rather than
   * two per lecturer — this is read for a whole page of a directory at a time.
   *
   * Answers with a lookup rather than a map so that a caller reading a row it
   * already holds cannot end up with an `undefined` it has to invent a fallback
   * for. A semester of `undefined` means the faculty has none open, in which
   * case nobody is supervising anything yet and the answer is the quota alone.
   */
  async loadFor(
    lecturers: Quota[],
    semesterId: number | undefined,
  ): Promise<(lecturer: Quota) => MentoringLoad> {
    const ids = lecturers.map((lecturer) => lecturer.id);

    const [groups, reserved] =
      semesterId === undefined || ids.length === 0
        ? [new Map<number, number>(), new Map<number, number>()]
        : await Promise.all([
            this.countGroups(ids, semesterId),
            this.countReserved(ids, semesterId),
          ]);

    return (lecturer) =>
      describe(
        groups.get(lecturer.id) ?? 0,
        reserved.get(lecturer.id) ?? 0,
        lecturer.maxMentoringQuota,
      );
  }

  /** The same answer for one lecturer. */
  async loadForOne(
    lecturer: Quota,
    semesterId: number | undefined,
  ): Promise<MentoringLoad> {
    const lookup = await this.loadFor([lecturer], semesterId);

    return lookup(lecturer);
  }

  /**
   * Throws when taking on one more would put this lecturer over the ceiling.
   *
   * Only ever called where the lecturer is the one deciding — accepting a
   * proposal is their own choice, so a refusal here tells them something they
   * can act on. It is deliberately not applied when a *student* registers: the
   * student did not set the quota, cannot see it, and refusing them at the last
   * second for their supervisor's paperwork would be the system blaming the
   * wrong person.
   */
  async requireRoomForOneMore(
    lecturer: Quota,
    semesterId: number,
  ): Promise<void> {
    const load = await this.loadForOne(lecturer, semesterId);

    if (!load.atQuota) return;

    throw new ConflictException(
      `Bạn đã nhận đủ ${load.quota} nhóm cho học kỳ này (${load.groups} nhóm đang hướng dẫn, ${load.reserved} đề tài đã nhận đang chờ sinh viên đăng ký), nên chưa nhận thêm được. Bạn vẫn có thể từ chối kèm nhận xét, hoặc đề nghị khoa nâng hạn mức.`,
    );
  }

  /**
   * The term a load is counted in: the one the faculty currently has open.
   *
   * Lives here rather than being asked for by every caller, because "how much is
   * this lecturer supervising" is always a question about now — a count across
   * every term they have ever taught is not a workload, it is a career.
   */
  async activeSemesterId(): Promise<number | undefined> {
    const semester = await this.prisma.semester.findFirst({
      where: { isActive: true },
      select: { id: true },
    });

    return semester?.id;
  }

  private async countGroups(ids: number[], semesterId: number) {
    const rows = await this.prisma.registrationGroup.findMany({
      where: {
        semesterId,
        // A group that was turned down handed the topic back, so it is not
        // work anybody is doing.
        status: { not: RegistrationGroupStatus.REJECTED },
        topic: { lecturerId: { in: ids } },
      },
      select: { topic: { select: { lecturerId: true } } },
    });

    return tally(rows.map((row) => row.topic.lecturerId));
  }

  /**
   * Topics written out of an accepted proposal that nobody has registered on.
   *
   * Bounded to rounds whose gate has not shut, because the reservation itself
   * is: from RECONCILING the faculty office may place anyone on the topic, so it
   * is no longer a place promised to one student and no longer a commitment made
   * by this lecturer. The phase read here is the stored one, which can lag the
   * calendar by however long it is since anybody looked at that round — always
   * in the direction of counting a lapsed reservation, never of missing a live
   * one.
   */
  private async countReserved(ids: number[], semesterId: number) {
    const rows = await this.prisma.topic.findMany({
      where: {
        semesterId,
        lecturerId: { in: ids },
        sourceProposalId: { not: null },
        round: { phase: { in: [...OPEN_ENOUGH_TO_HOLD] } },
        registrationGroups: {
          none: { status: { not: RegistrationGroupStatus.REJECTED } },
        },
      },
      select: { lecturerId: true },
    });

    return tally(rows.map((row) => row.lecturerId));
  }
}

function tally(ids: number[]): Map<number, number> {
  const counts = new Map<number, number>();

  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);

  return counts;
}

function describe(
  groups: number,
  reserved: number,
  quota: number | null,
): MentoringLoad {
  return {
    groups,
    reserved,
    quota,
    // `>=` rather than `===`: the office can lower a quota below a load already
    // taken on, and a lecturer sitting above their new ceiling is full, not
    // free.
    atQuota: quota !== null && groups + reserved >= quota,
  };
}
