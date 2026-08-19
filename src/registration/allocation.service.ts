import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GroupJoinSource,
  GroupMemberStatus,
  NotificationType,
  Prisma,
  RegistrationGroupStatus,
  RoundPhase,
  TopicStatus,
} from '../../generated/prisma/client';
import {
  isUniqueViolation,
  uniqueConstraintName,
} from '../common/prisma-error.util';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RoundPhaseService } from '../rounds/round-phase.service';
import { FinalizeRoundDto, PlaceStudentDto } from './dto/allocation.dto';
import { statusForSeats } from './group-seats';

/**
 * The faculty office's desk: the students the gate closed on, and the seats left
 * to put them in.
 *
 * This is the only path into a registration group that is not a student acting
 * for themselves, and it deliberately steps over four rules that path enforces —
 * a group that shut its door, seats a leader was holding, a topic reserved for
 * the student who proposed it, and the phase gate itself. Every one of those
 * exists to protect students from each other while the gate is open. Once it has
 * shut none of them is still standing: the holds have lapsed, the reservation is
 * over by its own terms, and there is nobody left to race.
 *
 * Which is exactly why the whole controller is `@Roles('ADMIN')` and why this
 * service is not exported from its module. It is not a more powerful version of
 * registering; it is a different action, performed by somebody else, in a phase
 * where students can do nothing at all.
 */
@Injectable()
export class AllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phases: RoundPhaseService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Everything the desk shows, in one read.
   *
   * Readable in any phase rather than only in RECONCILING: an office watching a
   * round run down wants to know how many students are still without a topic
   * long before it can do anything about them, and a screen that refuses to load
   * until the deadline passes is one nobody trusts on the day. What the phase
   * decides is `canPlace`, which is about the buttons.
   */
  async desk(roundId: number) {
    const round = await this.requireRound(roundId);
    const phase = await this.phases.resolve(roundId);

    const [students, topics, placements] = await Promise.all([
      this.unplacedStudents(round),
      this.topicsWithSeats(roundId),
      this.placementsMade(roundId),
    ]);

    const open = topics.filter((topic) => topic.status === TopicStatus.OPEN);
    const unopened = topics.filter(
      (topic) => topic.status === TopicStatus.APPROVED,
    );
    const openSeats = sumSeats(open);

    return {
      round: {
        id: round.id,
        phase,
        semester: round.semester,
        projectType: round.projectType,
        cohorts: round.eligibilities.map((rule) => rule.cohort),
      },
      canPlace: phase === RoundPhase.RECONCILING,
      /** Why the buttons are missing, in the phases where they are. */
      blockedReason:
        phase === RoundPhase.RECONCILING ? null : PLACEMENT_CLOSED[phase],
      summary: {
        unplacedCount: students.length,
        openSeats,
        /**
         * How many students there is provably nowhere to put. The first number
         * the office looks for, and the one that decides whether this is an
         * afternoon of clicking or a morning of phone calls.
         */
        shortfall: Math.max(0, students.length - openSeats),
        /**
         * Approved topics whose supervisor never opened them — the only slack
         * left when the seats run out. Reported rather than used: opening a
         * topic is the supervisor's decision, and the office reaching past them
         * to do it would be arranging somebody's teaching without asking.
         */
        unopenedTopics: unopened.length,
        unopenedSeats: sumSeats(unopened),
      },
      students,
      topics: open,
      /**
       * What this desk has already done, newest first.
       *
       * Without it the screen has no way back: a placed student leaves the
       * unplaced list and a filled topic leaves the seats list, so a misclick
       * would become invisible the moment it was made — and the undo endpoint
       * would be one nothing could reach.
       */
      placements,
    };
  }

  /**
   * Put one student on one topic.
   *
   * Creates the group when the topic has none — the student leads it, exactly as
   * if they had registered it themselves — and joins the existing one otherwise.
   */
  async place(roundId: number, dto: PlaceStudentDto, adminUserId: number) {
    const round = await this.requirePlaceableRound(roundId);
    const student = await this.requirePlaceableStudent(dto.studentId, round);
    const topic = await this.requirePlaceableTopic(dto.topicId, roundId);

    const placement = await this.prisma
      .$transaction(async (tx) => {
        /*
          The topic row rather than the group row, because at this moment there
          may be no group to lock: two placements onto the same empty topic would
          both find nothing, both create one, and only the unique index would
          stop the second — after the first had already notified everybody.
          Locking the topic serialises both shapes of the operation.
        */
        await tx.$queryRaw`SELECT 1 FROM "topics" WHERE "id" = ${topic.id} FOR UPDATE`;

        const group = await tx.registrationGroup.findFirst({
          where: {
            topicId: topic.id,
            status: { not: RegistrationGroupStatus.REJECTED },
          },
          select: {
            id: true,
            leaderId: true,
            members: {
              where: { status: GroupMemberStatus.ACCEPTED },
              select: {
                studentId: true,
                student: { select: { userId: true } },
              },
            },
          },
        });

        const occupied = group?.members.length ?? 0;

        if (occupied >= topic.maxStudents) {
          throw new ConflictException(
            `Đề tài "${topic.title}" đã đủ ${topic.maxStudents} sinh viên.`,
          );
        }

        const groupId = group
          ? group.id
          : await this.openGroupFor(tx, topic, student.id);

        await tx.registrationGroupMember.create({
          data: {
            groupId,
            semesterId: topic.semesterId,
            studentId: student.id,
            status: GroupMemberStatus.ACCEPTED,
            joinSource: GroupJoinSource.ASSIGNED,
            assignedById: adminUserId,
            assignedAt: new Date(),
            joinedAt: new Date(),
          },
        });

        await tx.registrationGroup.update({
          where: { id: groupId },
          data: { status: statusForSeats(occupied + 1, topic.maxStudents) },
        });

        await tx.auditLog.create({
          data: {
            userId: adminUserId,
            action: 'ASSIGN_GROUP_MEMBER',
            targetTable: 'registration_group_members',
            targetId: `${groupId}:${student.id}`,
            newValue: {
              roundId,
              topicId: topic.id,
              groupId,
              studentId: student.id,
              studentCode: student.studentCode,
              createdGroup: group === null,
            },
          },
        });

        // Gathered inside the lock, so it is exactly who was in the group at the
        // moment this student was put into it.
        return {
          groupId,
          existingMemberUserIds: (group?.members ?? []).map(
            (member) => member.student.userId,
          ),
        };
      })
      .catch((err: unknown) => {
        throw translatePlacementConflict(err);
      });

    await this.announcePlacement(placement, student, topic);

    return {
      groupId: placement.groupId,
      topicId: topic.id,
      studentId: student.id,
      message: `Đã xếp ${student.fullName} vào đề tài "${topic.title}".`,
    };
  }

  /**
   * Undo a placement.
   *
   * Only ever the office's own: a student who chose a topic themselves is not
   * the office's to move, and the request is refused rather than quietly
   * treated as a removal. Whoever is standing at this desk is correcting their
   * own work, not overruling somebody else's.
   */
  async unplace(roundId: number, studentId: number, adminUserId: number) {
    await this.requirePlaceableRound(roundId);
    const member = await this.requireOwnPlacement(roundId, studentId);

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "topics" WHERE "id" = ${member.group.topicId} FOR UPDATE`;

      await tx.registrationGroupMember.delete({ where: { id: member.id } });

      const remaining = await tx.registrationGroupMember.findMany({
        where: {
          groupId: member.groupId,
          status: GroupMemberStatus.ACCEPTED,
        },
        select: { studentId: true, joinedAt: true },
        // Whoever has been in it longest takes it over, which for a group the
        // office built is the first person it put there.
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      });

      if (remaining.length === 0) {
        /*
          Marked rather than deleted, which is what disbanding a group does and
          for the same reason: the partial index that keeps one live group per
          topic ignores REJECTED rows, so the topic goes back on the desk while
          the fact that a group briefly existed stays on the table.
        */
        await tx.registrationGroup.update({
          where: { id: member.groupId },
          data: { status: RegistrationGroupStatus.REJECTED },
        });
      } else {
        await tx.registrationGroup.update({
          where: { id: member.groupId },
          data: {
            status: statusForSeats(
              remaining.length,
              member.group.topic.maxStudents,
            ),
            // A group whose leader has been taken out of it has nobody to
            // answer for it, and nothing else in the system would notice.
            ...(member.group.leaderId === studentId && {
              leaderId: remaining[0].studentId,
            }),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: adminUserId,
          action: 'UNASSIGN_GROUP_MEMBER',
          targetTable: 'registration_group_members',
          targetId: `${member.groupId}:${studentId}`,
          oldValue: {
            roundId,
            topicId: member.group.topicId,
            groupId: member.groupId,
            studentId,
            studentCode: member.student.studentCode,
          },
        },
      });
    });

    /*
      The placement notice is left where it is rather than deleted. Withdrawing a
      proposal removes the notice it raised, because nobody had acted on it and
      the record is of something that never happened — here somebody was told a
      true thing that has since been undone, and two notices in order read as
      what actually occurred.
    */
    await this.notifications.notify([
      {
        userId: member.student.userId,
        type: NotificationType.GROUP_MEMBER_REMOVED,
        title: 'Bạn đã được chuyển khỏi đề tài',
        content: `Khoa đã chuyển bạn khỏi đề tài "${member.group.topic.title}" trong lúc sắp xếp. Bạn sẽ được xếp vào một đề tài khác trước khi khoa chốt danh sách.`,
        targetId: member.group.topicId,
      },
    ]);

    return {
      studentId,
      message: `Đã bỏ ${member.student.fullName} khỏi đề tài "${member.group.topic.title}".`,
    };
  }

  /**
   * Close the round: every membership in it becomes the official record.
   *
   * The last state change a round makes, and the only one no date can make for
   * it — ending RECONCILING means somebody decided the placement work was done,
   * which is why the row records who and when.
   */
  async finalize(roundId: number, dto: FinalizeRoundDto, adminUserId: number) {
    const round = await this.requireRound(roundId);
    const phase = await this.phases.resolve(roundId);

    if (phase !== RoundPhase.RECONCILING) {
      throw new ConflictException(
        phase === RoundPhase.FINALIZED
          ? 'Đợt này đã được chốt rồi.'
          : 'Chỉ chốt được đợt đang ở bước phân bổ, tức là sau khi cổng đăng ký đã đóng.',
      );
    }

    const unplaced = await this.unplacedStudents(round);

    if (unplaced.length > 0 && !dto.acknowledgeUnplaced) {
      throw new ConflictException(
        `Còn ${unplaced.length} sinh viên chưa được xếp đề tài. Xếp nốt, hoặc chốt kèm lý do nếu các bạn ấy thực sự không tham gia học kỳ này.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Guarded on the phase rather than a plain update: two administrators
      // pressing at once would otherwise both write, and the second would
      // record itself as the author of a decision the first had already made.
      const { count } = await tx.registrationRound.updateMany({
        where: { id: roundId, phase: RoundPhase.RECONCILING },
        data: {
          phase: RoundPhase.FINALIZED,
          finalisedAt: new Date(),
          finalisedById: adminUserId,
        },
      });

      if (count === 0) {
        throw new ConflictException(
          'Đợt này vừa thay đổi trạng thái — tải lại trang rồi thử lại.',
        );
      }

      await tx.auditLog.create({
        data: {
          userId: adminUserId,
          action: 'FINALIZE_REGISTRATION_ROUND',
          targetTable: 'registration_rounds',
          targetId: String(roundId),
          oldValue: { phase: RoundPhase.RECONCILING },
          newValue: {
            phase: RoundPhase.FINALIZED,
            unplacedCount: unplaced.length,
            unplacedStudentCodes: unplaced.map(
              (student) => student.studentCode,
            ),
            // The only record of why a round was sealed with students left out
            // of it, which is the reason the field is required to acknowledge.
            ...(dto.acknowledgeUnplaced && { reason: dto.reason }),
          },
        },
      });
    });

    await this.announceOutcome(roundId, unplaced);

    return {
      roundId,
      unplacedCount: unplaced.length,
      message:
        unplaced.length === 0
          ? 'Đã chốt phân bổ cho đợt này.'
          : `Đã chốt phân bổ. ${unplaced.length} sinh viên không được xếp đề tài trong học kỳ này.`,
    };
  }

  // ── the two lists ─────────────────────────────────────────

  /**
   * Students this round covers who have nowhere to be.
   *
   * "Covers" is by intake, because that is the only thing a round is declared
   * against. Having a group is checked across the whole semester rather than
   * within this round: a student holds one place per term, so somebody already
   * on a Cơ sở topic is not waiting for a Tốt nghiệp seat — they are done.
   *
   * That also means two rounds in one semester share a single pool of students,
   * and a student placed at one desk disappears from the other. The database
   * enforces it; this only reports it.
   */
  private async unplacedStudents(round: RoundRow) {
    const cohorts = round.eligibilities.map((rule) => rule.cohort);

    if (cohorts.length === 0) return [];

    const students = await this.prisma.studentProfile.findMany({
      where: {
        cohort: { in: cohorts },
        // A locked or departed account is not somebody the office is still
        // trying to place.
        user: { isActive: true },
        groupMemberships: {
          none: {
            semesterId: round.semesterId,
            status: GroupMemberStatus.ACCEPTED,
            group: { status: { not: RegistrationGroupStatus.REJECTED } },
          },
        },
      },
      select: {
        id: true,
        studentCode: true,
        fullName: true,
        class: true,
        cohort: true,
        major: { select: { id: true, name: true, code: true } },
        user: { select: { id: true, email: true, avatarUrl: true } },
      },
      orderBy: { studentCode: 'asc' },
    });

    return students.map(({ user, ...student }) => ({
      ...student,
      userId: user.id,
      email: user.email,
      avatarUrl: user.avatarUrl,
    }));
  }

  /**
   * Placements this desk has made in this round, newest first.
   *
   * Only the office's own — `joinSource: ASSIGNED` — because those are the only
   * ones it may take back, and a list mixing them with students who chose for
   * themselves would offer an undo on two thirds of it that the API refuses.
   */
  private async placementsMade(roundId: number) {
    const members = await this.prisma.registrationGroupMember.findMany({
      where: {
        status: GroupMemberStatus.ACCEPTED,
        joinSource: GroupJoinSource.ASSIGNED,
        group: {
          status: { not: RegistrationGroupStatus.REJECTED },
          topic: { roundId },
        },
      },
      select: {
        assignedAt: true,
        student: {
          select: { id: true, studentCode: true, fullName: true, class: true },
        },
        group: {
          select: {
            id: true,
            topicId: true,
            topic: { select: { title: true } },
          },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });

    return members.map((member) => ({
      student: member.student,
      groupId: member.group.id,
      topicId: member.group.topicId,
      topicTitle: member.group.topic.title,
      assignedAt: member.assignedAt,
    }));
  }

  /**
   * Topics in this round that still have room, open ones and unopened ones
   * together — the caller splits them, because they are two different offers.
   */
  private async topicsWithSeats(roundId: number) {
    const topics = await this.prisma.topic.findMany({
      where: {
        roundId,
        status: { in: [TopicStatus.OPEN, TopicStatus.APPROVED] },
      },
      select: {
        id: true,
        title: true,
        maxStudents: true,
        status: true,
        lecturer: {
          select: { id: true, fullName: true, academicTitle: true },
        },
        registrationGroups: {
          where: { status: { not: RegistrationGroupStatus.REJECTED } },
          select: {
            id: true,
            name: true,
            _count: {
              select: {
                members: { where: { status: GroupMemberStatus.ACCEPTED } },
              },
            },
          },
          take: 1,
        },
      },
      orderBy: { title: 'asc' },
    });

    return topics
      .map(({ registrationGroups, ...topic }) => {
        const group = registrationGroups[0];
        const occupiedSeats = group?._count.members ?? 0;

        return {
          ...topic,
          occupiedSeats,
          freeSeats: Math.max(0, topic.maxStudents - occupiedSeats),
          group: group ? { id: group.id, name: group.name } : null,
        };
      })
      .filter((topic) => topic.freeSeats > 0);
  }

  // ── guards ────────────────────────────────────────────────

  private async requireRound(roundId: number) {
    const round = await this.prisma.registrationRound.findUnique({
      where: { id: roundId },
      select: {
        id: true,
        semesterId: true,
        semester: { select: { id: true, name: true, code: true } },
        projectType: { select: { id: true, name: true, code: true } },
        eligibilities: { select: { cohort: true } },
      },
    });

    if (!round) throw new NotFoundException('Không tìm thấy đợt đăng ký');

    return round;
  }

  /** The round, and the phase in which placing anybody is allowed at all. */
  private async requirePlaceableRound(roundId: number) {
    const round = await this.requireRound(roundId);
    const phase = await this.phases.resolve(roundId);

    if (phase !== RoundPhase.RECONCILING) {
      throw new ConflictException(PLACEMENT_CLOSED[phase]);
    }

    return round;
  }

  private async requirePlaceableStudent(studentId: number, round: RoundRow) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        studentCode: true,
        fullName: true,
        cohort: true,
        userId: true,
        user: { select: { isActive: true } },
      },
    });

    if (!student || !student.user.isActive) {
      throw new NotFoundException('Không tìm thấy sinh viên này');
    }

    const cohorts = round.eligibilities.map((rule) => rule.cohort);

    if (student.cohort === null || !cohorts.includes(student.cohort)) {
      throw new ForbiddenException(
        `Khóa ${student.cohort ?? 'chưa rõ'} không thuộc đợt này, nên không xếp ${student.fullName} vào đây được.`,
      );
    }

    // Checked before the write as well as by the index behind it, so the common
    // case answers with a sentence naming the student rather than a collision.
    const existing = await this.prisma.registrationGroupMember.findFirst({
      where: {
        studentId,
        semesterId: round.semesterId,
        status: GroupMemberStatus.ACCEPTED,
        group: { status: { not: RegistrationGroupStatus.REJECTED } },
      },
      select: { group: { select: { topic: { select: { title: true } } } } },
    });

    if (existing) {
      throw new ConflictException(
        `${student.fullName} đã có đề tài trong học kỳ này ("${existing.group.topic.title}").`,
      );
    }

    return student;
  }

  private async requirePlaceableTopic(topicId: number, roundId: number) {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: {
        id: true,
        title: true,
        roundId: true,
        semesterId: true,
        maxStudents: true,
        status: true,
        lecturer: { select: { userId: true } },
      },
    });

    if (!topic || topic.roundId !== roundId) {
      throw new NotFoundException('Không tìm thấy đề tài này trong đợt');
    }

    if (topic.status !== TopicStatus.OPEN) {
      throw new ConflictException(
        `Đề tài "${topic.title}" chưa mở đăng ký, nên chưa xếp ai vào được. Đề nghị giảng viên mở đề tài trước.`,
      );
    }

    return topic;
  }

  /** A placement this desk made, and therefore one it may take back. */
  private async requireOwnPlacement(roundId: number, studentId: number) {
    const member = await this.prisma.registrationGroupMember.findFirst({
      where: {
        studentId,
        status: GroupMemberStatus.ACCEPTED,
        group: {
          status: { not: RegistrationGroupStatus.REJECTED },
          topic: { roundId },
        },
      },
      select: {
        id: true,
        groupId: true,
        joinSource: true,
        student: {
          select: { id: true, fullName: true, studentCode: true, userId: true },
        },
        group: {
          select: {
            topicId: true,
            leaderId: true,
            topic: { select: { title: true, maxStudents: true } },
          },
        },
      },
    });

    if (!member) {
      throw new NotFoundException(
        'Sinh viên này chưa được xếp vào đề tài nào trong đợt',
      );
    }

    if (member.joinSource !== GroupJoinSource.ASSIGNED) {
      throw new ConflictException(
        `${member.student.fullName} tự đăng ký đề tài "${member.group.topic.title}", không phải khoa xếp — nên không bỏ ở đây được.`,
      );
    }

    return member;
  }

  // ── writes and notices ────────────────────────────────────

  /**
   * The group a placed student lands in when the topic had none.
   *
   * Closed to joining and with no invite link, unlike a group a student
   * registers: there is nobody left to invite once the gate has shut, and a
   * link that outlived an extension would be a way back in that nobody meant
   * to leave open.
   */
  private async openGroupFor(
    tx: Prisma.TransactionClient,
    topic: { id: number; semesterId: number; maxStudents: number },
    leaderId: number,
  ) {
    const group = await tx.registrationGroup.create({
      data: {
        topicId: topic.id,
        semesterId: topic.semesterId,
        leaderId,
        openForJoin: false,
        joinCode: null,
        status: statusForSeats(0, topic.maxStudents),
      },
      select: { id: true },
    });

    return group.id;
  }

  private async announcePlacement(
    placement: { groupId: number; existingMemberUserIds: number[] },
    student: { fullName: string; userId: number },
    topic: { id: number; title: string; lecturer: { userId: number } },
  ) {
    await this.notifications.notify([
      {
        userId: student.userId,
        type: NotificationType.GROUP_MEMBER_ASSIGNED,
        title: 'Khoa đã xếp bạn vào một đề tài',
        content: `Bạn được xếp vào đề tài "${topic.title}". Mở trang nhóm để xem đề tài và những bạn cùng nhóm.`,
        targetId: placement.groupId,
      },
      ...placement.existingMemberUserIds.map((userId) => ({
        userId,
        type: NotificationType.GROUP_MEMBER_ASSIGNED,
        title: 'Nhóm của bạn có thêm thành viên',
        content: `Khoa đã xếp ${student.fullName} vào nhóm đề tài "${topic.title}".`,
        targetId: placement.groupId,
      })),
      {
        userId: topic.lecturer.userId,
        type: NotificationType.TOPIC_STUDENT_ASSIGNED,
        title: 'Khoa xếp sinh viên vào đề tài của bạn',
        content: `${student.fullName} được khoa xếp vào đề tài "${topic.title}" của bạn.`,
        targetId: topic.id,
      },
    ]);
  }

  /**
   * What the round settled into, told to both kinds of reader it produced.
   *
   * The students it found nothing for are notified too, and that is the half
   * that matters: the app has been promising them "bạn sẽ nhận được thông báo
   * khi kết quả được chốt" since the gate closed, and being left out is exactly
   * the outcome somebody would otherwise discover in week three.
   */
  private async announceOutcome(
    roundId: number,
    unplaced: { userId: number }[],
  ) {
    const placed = await this.prisma.registrationGroupMember.findMany({
      where: {
        status: GroupMemberStatus.ACCEPTED,
        group: {
          status: { not: RegistrationGroupStatus.REJECTED },
          topic: { roundId },
        },
      },
      select: { student: { select: { userId: true } } },
    });

    await this.notifications.notify([
      ...placed.map((member) => ({
        userId: member.student.userId,
        type: NotificationType.ROUND_FINALIZED,
        title: 'Đề tài của bạn đã được chốt',
        content:
          'Khoa đã chốt phân bổ cho đợt này. Đề tài và nhóm của bạn giờ là chính thức, từ đây là phần làm đồ án.',
        targetId: roundId,
      })),
      ...unplaced.map((student) => ({
        userId: student.userId,
        type: NotificationType.ROUND_FINALIZED,
        title: 'Học kỳ này bạn chưa có đề tài',
        content:
          'Khoa đã chốt phân bổ và bạn chưa được xếp vào đề tài nào trong học kỳ này. Liên hệ giáo vụ khoa nếu đây là sai sót.',
        targetId: roundId,
      })),
    ]);
  }
}

type RoundRow = {
  id: number;
  semesterId: number;
  eligibilities: { cohort: string }[];
};

/** Why the desk is read-only, named by the phase it is read-only in. */
const PLACEMENT_CLOSED: Record<Exclude<RoundPhase, 'RECONCILING'>, string> = {
  [RoundPhase.PREP]:
    'Cổng đăng ký chưa mở, nên chưa có ai để xếp — sinh viên vẫn đang chờ đến lượt chọn đề tài.',
  [RoundPhase.OPEN]:
    'Cổng đăng ký còn mở. Danh sách sinh viên chưa có nhóm vẫn đang thay đổi, nên xếp tay lúc này sẽ giẫm lên lựa chọn của các bạn ấy.',
  [RoundPhase.EXTENDED]:
    'Đợt đang gia hạn cho các bạn chưa có nhóm. Đợi hết hạn gia hạn rồi xếp, nếu không danh sách sẽ đổi ngay dưới tay bạn.',
  [RoundPhase.FINALIZED]:
    'Đợt này đã chốt phân bổ, danh sách là chính thức và không đổi được nữa.',
};

function sumSeats(topics: { freeSeats: number }[]): number {
  return topics.reduce((total, topic) => total + topic.freeSeats, 0);
}

/**
 * The two collisions worth naming, in the words of somebody working a desk
 * rather than of a student pressing register.
 */
function translatePlacementConflict(err: unknown): unknown {
  if (err instanceof ConflictException || err instanceof NotFoundException) {
    return err;
  }

  if (!isUniqueViolation(err)) return err;

  const target = uniqueConstraintName(err);

  if (target.includes('one_accepted_per_semester')) {
    return new ConflictException(
      'Sinh viên này vừa được xếp vào một đề tài khác — tải lại danh sách rồi xếp tiếp.',
    );
  }

  if (target.includes('one_live_per_topic')) {
    return new ConflictException(
      'Đề tài này vừa có nhóm khác nhận — tải lại danh sách rồi chọn đề tài khác.',
    );
  }

  return new ConflictException(
    'Thao tác vừa rồi trùng với một thao tác khác — tải lại danh sách rồi thử lại.',
  );
}
