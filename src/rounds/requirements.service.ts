import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { recordAudit } from '../audit/audit-entry';
import { PrismaService } from '../prisma/prisma.service';
import { SetRequirementsDto } from './dto/set-requirements.dto';

/** Everything a caller reads about one required document. */
export const REQUIREMENT_SELECT = {
  id: true,
  name: true,
  dueAt: true,
  isRequired: true,
  sortOrder: true,
} satisfies Prisma.SubmissionRequirementSelect;

/**
 * What each round asks its groups to hand in, and by when.
 *
 * The office keeps this list, not individual supervisors, and that is a rule
 * rather than an accident of where the screen ended up. Two students of one
 * intake whose deadlines differ because they chose different supervisors is a
 * complaint the faculty cannot answer; and once every supervisor sets their own
 * dates, "how far along is this round" has no answer at all, because a group
 * that looks behind may simply have a later deadline. A supervisor's own
 * arrangement with their group — send me chapter two by Friday — is a different
 * thing, and when it is built it becomes rows scoped to a group rather than to
 * a round.
 */
@Injectable()
export class RequirementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The list for one round, in the order the office arranged it. */
  async findForRound(roundId: number) {
    await this.requireRound(roundId);

    return this.prisma.submissionRequirement.findMany({
      where: { roundId },
      select: REQUIREMENT_SELECT,
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Replaces a round's list wholesale.
   *
   * The one refusal worth naming: a document groups have already handed work in
   * against cannot be taken off the list. Removing it would delete their
   * submissions along with whatever their supervisor wrote on them — so the
   * office is told which rows are in the way rather than discovering afterwards
   * that a week of feedback is gone.
   */
  async setForRound(roundId: number, dto: SetRequirementsDto, actorId: number) {
    await this.requireRound(roundId);

    const existing = await this.prisma.submissionRequirement.findMany({
      where: { roundId },
      select: {
        id: true,
        name: true,
        dueAt: true,
        isRequired: true,
        _count: { select: { submissions: true } },
      },
    });

    const kept = new Set(
      dto.requirements.flatMap((one) => (one.id === undefined ? [] : [one.id])),
    );
    const dropped = existing.filter((row) => !kept.has(row.id));
    const blocked = dropped.filter((row) => row._count.submissions > 0);

    if (blocked.length > 0) {
      throw new ConflictException(
        `Không bỏ được ${blocked
          .map((row) => `"${row.name}"`)
          .join(
            ', ',
          )} khỏi danh sách vì đã có nhóm nộp bài. Đổi tên hoặc dời hạn thì được.`,
      );
    }

    // An id the caller made up, or one belonging to another round, would
    // otherwise update a row this round does not own.
    const known = new Set(existing.map((row) => row.id));
    const stranger = dto.requirements.find(
      (one) => one.id !== undefined && !known.has(one.id),
    );

    if (stranger) {
      throw new NotFoundException(
        `Không tìm thấy mục "${stranger.name}" trong đợt này — tải lại trang rồi thử lại.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      if (dropped.length > 0) {
        await tx.submissionRequirement.deleteMany({
          where: { id: { in: dropped.map((row) => row.id) } },
        });
      }

      // Sequential rather than in parallel: the rows carry a unique name per
      // round, and a rename that swaps two names only survives if the writes
      // are ordered.
      for (const [index, one] of dto.requirements.entries()) {
        const data = {
          name: one.name,
          dueAt: one.dueAt,
          isRequired: one.isRequired,
          sortOrder: index,
        };

        if (one.id === undefined) {
          await tx.submissionRequirement.create({ data: { roundId, ...data } });
        } else {
          await tx.submissionRequirement.update({
            where: { id: one.id },
            data,
          });
        }
      }

      // One entry for the list rather than one per row: what the office decided
      // is "this is what the đợt hands in", and a reader asking why a deadline
      // moved wants that announcement, not four rows to reassemble.
      await recordAudit(tx, {
        userId: actorId,
        action: 'SET_SUBMISSION_REQUIREMENTS',
        targetTable: 'registration_rounds',
        targetId: roundId,
        oldValue: {
          requirements: existing.map((row) => ({
            name: row.name,
            dueAt: row.dueAt.toISOString(),
            isRequired: row.isRequired,
          })),
        },
        newValue: {
          requirements: dto.requirements.map((one) => ({
            name: one.name,
            dueAt: one.dueAt.toISOString(),
            isRequired: one.isRequired,
          })),
        },
      });
    });

    return this.findForRound(roundId);
  }

  /**
   * The requirement a group is handing in against, refusing anything that is
   * not their round's.
   *
   * A group reaches its round through its topic, and nothing in the database
   * ties a requirement to a group directly — so this is the check that keeps a
   * student from submitting against another đợt's deadline by sending its id.
   */
  async requireForRound(requirementId: number, roundId: number) {
    const requirement = await this.prisma.submissionRequirement.findFirst({
      where: { id: requirementId, roundId },
      select: REQUIREMENT_SELECT,
    });

    if (!requirement) {
      throw new NotFoundException(
        'Mục này không nằm trong danh sách bài nộp của đợt bạn đang làm.',
      );
    }

    return requirement;
  }

  private async requireRound(roundId: number) {
    const round = await this.prisma.registrationRound.findUnique({
      where: { id: roundId },
      select: { id: true },
    });

    if (!round) throw new NotFoundException(`Round ${roundId} not found`);
  }
}
