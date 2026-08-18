import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GroupJoinSource,
  GroupMemberStatus,
  NotificationType,
  Prisma,
  RegistrationGroupStatus,
  Role,
  TopicStatus,
} from '../../generated/prisma/client';
import {
  isUniqueViolation,
  uniqueConstraintName,
} from '../common/prisma-error.util';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RoundPhaseService } from '../rounds/round-phase.service';
import { QueryMyGroupDto } from './dto/query-my-group.dto';
import { RegisterTopicDto } from './dto/register-topic.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import {
  generateJoinCode,
  holdExpiryFromNow,
  isHoldActive,
} from './join-code.util';

/**
 * A group and everything a member needs to see about it.
 *
 * Members carry their class and major because that is what a group screen shows
 * about the people you are working with, and no contact details beyond the
 * account address — the same line the topic detail draws for lecturers.
 */
const GROUP_SELECT = {
  id: true,
  topicId: true,
  semesterId: true,
  leaderId: true,
  name: true,
  status: true,
  openForJoin: true,
  declaredSize: true,
  holdUntil: true,
  joinCode: true,
  createdAt: true,
  topic: {
    select: {
      id: true,
      title: true,
      maxStudents: true,
      lecturerId: true,
      // The round is what every phase check is asked of — the group's own
      // semester is too coarse, since a semester runs one round per kind of
      // project and they open and close on their own schedules.
      roundId: true,
      lecturer: { select: { id: true, fullName: true, academicTitle: true } },
      round: {
        select: {
          projectType: { select: { id: true, name: true, code: true } },
        },
      },
    },
  },
  members: {
    // Only people actually in the group. Disbanding steps its members down to
    // DECLINED rather than deleting them, so without this filter a dissolved
    // group would still read as full and its seat arithmetic would count people
    // who are no longer in it.
    where: { status: GroupMemberStatus.ACCEPTED },
    select: {
      id: true,
      studentId: true,
      joinSource: true,
      joinedAt: true,
      student: {
        select: {
          id: true,
          studentCode: true,
          fullName: true,
          class: true,
          cohort: true,
          major: { select: { id: true, name: true, code: true } },
          // The account id is here to address notices to; `render` drops the
          // whole `user` object and re-exposes only the address, so it never
          // reaches a response.
          user: { select: { id: true, email: true, avatarUrl: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.RegistrationGroupSelect;

type GroupRow = Prisma.RegistrationGroupGetPayload<{
  select: typeof GROUP_SELECT;
}>;

/**
 * Which profile the caller reads a group through. Both ids are nullable because
 * an ADMIN has neither, and a role with a missing profile row has none either.
 */
interface Viewer {
  studentId: number | null;
  lecturerId: number | null;
  role: Role | null;
}

/**
 * How many seats a stranger may not take, and how many they may.
 *
 * A single hold flag would be too blunt. A topic for three whose leader declared
 * two has one seat that was never theirs to keep, and holding it would let a
 * group of two sit on a third place it has already said it does not want.
 */
function seatBreakdown(group: GroupRow) {
  const occupied = group.members.length;
  const capacity = group.topic.maxStudents;
  const holdActive = isHoldActive(group.holdUntil);

  const held =
    holdActive && group.declaredSize
      ? Math.max(0, Math.min(group.declaredSize, capacity) - occupied)
      : 0;

  return {
    occupied,
    capacity,
    holdActive,
    held,
    /** Seats a stranger without the link could take right now. */
    freeToAnyone: Math.max(0, capacity - occupied - held),
  };
}

/**
 * A group filling up is what used to be a leader pressing Submit. Nobody presses
 * anything now, so the status follows the seat count — and follows it back down
 * when a member leaves, since a group that is no longer full is forming again.
 */
function statusForSeats(
  occupied: number,
  capacity: number,
): RegistrationGroupStatus {
  return occupied >= capacity
    ? RegistrationGroupStatus.SUBMITTED
    : RegistrationGroupStatus.FORMING;
}

@Injectable()
export class RegistrationGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phases: RoundPhaseService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── register ──────────────────────────────────────────────

  /**
   * Take a topic: the group is created and the caller leads it.
   *
   * Registering and creating a group are one action, so there is no endpoint
   * that makes an empty group — a group with no topic is a state this model does
   * not have.
   */
  async register(topicId: number, dto: RegisterTopicDto, userId: number) {
    const student = await this.requireStudent(userId);
    const topic = await this.requireRegistrableTopic(topicId);

    await this.phases.requireCanJoin(topic.roundId, student.id);
    await this.requireEligible(topic, student.cohort);
    await this.requireNoExistingGroup(student.id, topic.semesterId);

    if (dto.declaredSize && dto.declaredSize > topic.maxStudents) {
      throw new BadRequestException(
        `This topic holds ${topic.maxStudents} student(s), so ${dto.declaredSize} cannot be declared`,
      );
    }

    // A group of one is still a group, so nothing here is conditional on having
    // friends. The join code is always issued: it is how a leader shares the
    // group at all, and outside the hold window it grants no more than the topic
    // page already does.
    const holdUntil = dto.declaredSize ? holdExpiryFromNow() : null;

    let created: { id: number };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const group = await tx.registrationGroup.create({
          data: {
            topicId: topic.id,
            semesterId: topic.semesterId,
            leaderId: student.id,
            name: dto.name,
            declaredSize: dto.declaredSize,
            holdUntil,
            joinCode: generateJoinCode(),
            status: statusForSeats(1, topic.maxStudents),
          },
          select: { id: true },
        });

        await tx.registrationGroupMember.create({
          data: {
            groupId: group.id,
            semesterId: topic.semesterId,
            studentId: student.id,
            status: GroupMemberStatus.ACCEPTED,
            joinSource: GroupJoinSource.SELF,
            joinedAt: new Date(),
          },
        });

        return group;
      });
    } catch (err) {
      throw this.translateRegistrationConflict(err);
    }

    return this.present(created.id, { studentId: student.id });
  }

  // ── join ──────────────────────────────────────────────────

  /**
   * Join whoever already holds this topic, without a link.
   *
   * Refused while seats are held, which is the whole point of holding them.
   */
  async joinTopic(topicId: number, userId: number) {
    const student = await this.requireStudent(userId);

    const group = await this.prisma.registrationGroup.findFirst({
      where: {
        topicId,
        status: { not: RegistrationGroupStatus.REJECTED },
      },
      select: GROUP_SELECT,
    });

    // Nothing is auto-created here on purpose: taking an unclaimed topic and
    // joining a group that exists are different decisions, and a client that
    // asked for one should not silently get the other.
    if (!group) {
      throw new ConflictException(
        'Nobody has registered this topic yet — register it instead of joining',
      );
    }

    await this.assertJoinable(group, student, { allowHeldSeats: false });

    return this.addMember(group.id, student, GroupJoinSource.SELF, {
      allowHeldSeats: false,
    });
  }

  /** Join through a group's link, which reaches the seats being held. */
  async joinByCode(joinCode: string, userId: number) {
    const student = await this.requireStudent(userId);
    const group = await this.requireGroupByCode(joinCode);

    await this.assertJoinable(group, student, { allowHeldSeats: true });

    return this.addMember(group.id, student, GroupJoinSource.LINK, {
      allowHeldSeats: true,
    });
  }

  /**
   * What a link leads to, before the person following it commits to it.
   *
   * A join link gets pasted into a group chat and forwarded, and joining spends
   * a student's single registration for the whole semester — so tapping a link
   * must not be the act that spends it. This is what lets the page show the topic,
   * the supervisor and who is already in before offering the button.
   *
   * Whether the caller may actually join is answered by running the very checks
   * the POST runs and reporting what they said, rather than by a second copy of
   * the rules. A preview that can disagree with the action it previews is worse
   * than no preview: it turns the button into a trap.
   */
  async previewByCode(joinCode: string, userId: number) {
    const student = await this.requireStudent(userId);
    const group = await this.requireGroupByCode(joinCode);
    const seats = seatBreakdown(group);

    const alreadyMember = group.members.some(
      (member) => member.studentId === student.id,
    );

    let blockedReason: string | null = null;
    if (!alreadyMember) {
      try {
        await this.assertJoinable(group, student, { allowHeldSeats: true });
      } catch (err) {
        if (!(err instanceof HttpException)) throw err;
        blockedReason = err.message;
      }
    }

    return {
      group: {
        id: group.id,
        name: group.name,
        occupiedSeats: seats.occupied,
        capacity: seats.capacity,
        isFull: seats.occupied >= seats.capacity,
        // Names only. Whoever holds the link is a legitimate invitee, not a
        // reason to hand over classmates' codes and addresses.
        members: group.members.map((member) => ({
          fullName: member.student.fullName,
          isLeader: member.studentId === group.leaderId,
        })),
      },
      topic: {
        id: group.topic.id,
        title: group.topic.title,
        projectType: group.topic.round.projectType,
        lecturer: group.topic.lecturer,
      },
      alreadyMember,
      canJoin: !alreadyMember && blockedReason === null,
      blockedReason,
    };
  }

  // ── read ──────────────────────────────────────────────────

  /** The caller's own group this semester, or null if they have none yet. */
  async findMine(query: QueryMyGroupDto, userId: number) {
    const student = await this.requireStudent(userId);
    const semesterId =
      query.semesterId ?? (await this.requireActiveSemesterId());

    const membership = await this.prisma.registrationGroupMember.findFirst({
      where: {
        studentId: student.id,
        semesterId,
        status: GroupMemberStatus.ACCEPTED,
        group: { status: { not: RegistrationGroupStatus.REJECTED } },
      },
      select: { groupId: true },
    });

    if (!membership) return null;

    return this.present(membership.groupId, { studentId: student.id });
  }

  /**
   * Readable by the group's own members, the supervising lecturer, and the
   * faculty office — and by nobody else, which is why an outsider gets a 404
   * rather than a 403.
   *
   * A student deciding whether to join does not need this: the topic detail
   * already tells them how many seats are taken and whether they may have one.
   * What it withholds is the members' names, and that is the point — a signed-in
   * student has no reason to be able to enumerate who is working on what.
   */
  async findOne(id: number, userId: number, role: Role) {
    const viewer = await this.resolveViewer(userId, role);
    const group = await this.loadGroup(id);

    if (!this.canView(group, viewer)) {
      throw new NotFoundException('Registration group not found');
    }

    return this.render(group, viewer);
  }

  // ── leader actions ────────────────────────────────────────

  async update(id: number, dto: UpdateGroupDto, userId: number) {
    const student = await this.requireStudent(userId);
    const group = await this.requireLeadership(id, student.id);

    await this.phases.requireCanLeave(group.topic.roundId);

    if (dto.leaderId !== undefined) {
      const successor = group.members.find(
        (member) => member.studentId === dto.leaderId,
      );

      if (!successor) {
        throw new BadRequestException(
          'A group can only be handed to one of its own members',
        );
      }
    }

    // Bounded by the people already here and by what the topic holds. Below the
    // membership it would describe a group smaller than it is; above the capacity
    // it would claim seats the topic does not have.
    if (dto.declaredSize != null) {
      if (dto.declaredSize < group.members.length) {
        throw new BadRequestException(
          `The group already has ${group.members.length} member(s), so it cannot declare ${dto.declaredSize}`,
        );
      }

      if (dto.declaredSize > group.topic.maxStudents) {
        throw new BadRequestException(
          `This topic holds ${group.topic.maxStudents} student(s), so ${dto.declaredSize} cannot be declared`,
        );
      }
    }

    await this.prisma.registrationGroup.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.openForJoin !== undefined && { openForJoin: dto.openForJoin }),
        ...(dto.declaredSize !== undefined && {
          declaredSize: dto.declaredSize,
        }),
        ...(dto.releaseHold && { holdUntil: null }),
        ...(dto.leaderId !== undefined && { leaderId: dto.leaderId }),
      },
    });

    return this.present(id, { studentId: student.id });
  }

  /**
   * Remove somebody from the group.
   *
   * Audited, because it is the only power one student holds over another in this
   * system: a leader can take a place away from someone who thought they had
   * one, and a faculty asked about it later needs an answer that is not "we
   * think so".
   */
  async removeMember(id: number, studentId: number, userId: number) {
    const student = await this.requireStudent(userId);
    const group = await this.requireLeadership(id, student.id);

    await this.phases.requireCanLeave(group.topic.roundId);

    if (studentId === group.leaderId) {
      throw new BadRequestException(
        'A leader cannot remove themselves — hand the group over or disband it',
      );
    }

    const member = group.members.find(
      (candidate) => candidate.studentId === studentId,
    );

    if (!member) {
      throw new NotFoundException('That student is not in this group');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.registrationGroupMember.delete({ where: { id: member.id } });

      await this.syncStatus(tx, id, group.topic.maxStudents);

      await tx.auditLog.create({
        data: {
          userId,
          action: 'REMOVE_GROUP_MEMBER',
          targetTable: 'registration_group_members',
          targetId: String(member.id),
          oldValue: {
            groupId: id,
            studentId,
            studentCode: member.student.studentCode,
            joinSource: member.joinSource,
          },
        },
      });
    });

    // The one thing here a student did not do to themselves, and the only way
    // they would otherwise learn of it is by finding themselves back on the
    // topic list with no explanation.
    await this.notifications.notify([
      {
        userId: member.student.user.id,
        type: NotificationType.GROUP_MEMBER_REMOVED,
        title: 'Bạn đã bị đưa ra khỏi nhóm',
        content: `Trưởng nhóm đã đưa bạn ra khỏi nhóm đề tài "${group.topic.title}". Nếu cổng đăng ký còn mở, bạn có thể chọn một đề tài khác.`,
        targetId: group.topicId,
      },
    ]);

    return this.present(id, { studentId: student.id });
  }

  /**
   * Give the topic back.
   *
   * REJECTED rather than deleted: the row is the record that this group existed
   * and walked away, and the partial unique index ignores REJECTED, so the topic
   * returns to the market on its own.
   *
   * The members must come down in the same transaction. The two partial indexes
   * do not know about each other — the one keeping a student to a single group
   * looks only at `status = 'ACCEPTED'`, not at whether the group still stands —
   * so a group left REJECTED with ACCEPTED members hands the topic back while
   * every one of its students stays locked out of registering again.
   */
  async disband(id: number, userId: number, role: Role) {
    let group: GroupRow;

    if (role === Role.ADMIN) {
      group = await this.loadGroup(id);

      if (group.status === RegistrationGroupStatus.REJECTED) {
        throw new ConflictException('This group has already been disbanded');
      }
    } else {
      const student = await this.requireStudent(userId);
      group = await this.requireLeadership(id, student.id);
    }

    await this.phases.requireCanLeave(group.topic.roundId);

    await this.prisma.$transaction([
      this.prisma.registrationGroupMember.updateMany({
        where: { groupId: id, status: GroupMemberStatus.ACCEPTED },
        data: { status: GroupMemberStatus.DECLINED },
      }),
      this.prisma.registrationGroup.update({
        where: { id },
        data: { status: RegistrationGroupStatus.REJECTED },
      }),
    ]);

    // Everybody except whoever pressed it — they were there, and a notice about
    // one's own action is noise that teaches people to stop reading them.
    await this.notifications.notify(
      group.members
        .filter((member) => member.student.user.id !== userId)
        .map((member) => ({
          userId: member.student.user.id,
          type: NotificationType.GROUP_DISBANDED,
          title: 'Nhóm của bạn đã giải tán',
          content: `Nhóm đề tài "${group.topic.title}" đã giải tán và đề tài trở lại danh sách. Nếu cổng đăng ký còn mở, bạn có thể chọn một đề tài khác.`,
          targetId: group.topicId,
        })),
    );

    return { message: 'Group disbanded and the topic is available again' };
  }

  // ── member actions ────────────────────────────────────────

  async leave(id: number, userId: number) {
    const student = await this.requireStudent(userId);
    const group = await this.loadGroup(id);

    await this.phases.requireCanLeave(group.topic.roundId);

    const member = group.members.find(
      (candidate) => candidate.studentId === student.id,
    );

    if (!member) throw new NotFoundException('You are not in this group');

    // Somebody has to answer for the group, and a group whose leader walked out
    // has nobody to hand it to, close it, or be asked about it.
    if (group.leaderId === student.id) {
      throw new ConflictException(
        'Hand the group to another member first, or disband it',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.registrationGroupMember.delete({ where: { id: member.id } });
      await this.syncStatus(tx, id, group.topic.maxStudents);
    });

    return { message: 'You have left the group' };
  }

  // ── internals ─────────────────────────────────────────────

  /**
   * Recomputes the group's status from what is actually in the table.
   *
   * Counted inside the transaction rather than derived from the copy loaded
   * before it: somebody may have joined in between, and a status worked out from
   * a stale roster would leave a full group reading as still forming.
   */
  private async syncStatus(
    tx: Prisma.TransactionClient,
    groupId: number,
    capacity: number,
  ) {
    const occupied = await tx.registrationGroupMember.count({
      where: { groupId, status: GroupMemberStatus.ACCEPTED },
    });

    await tx.registrationGroup.update({
      where: { id: groupId },
      data: { status: statusForSeats(occupied, capacity) },
    });
  }

  /**
   * Adds a member with the group row locked.
   *
   * Everything else in this model leans on a unique index instead of a lock, but
   * no index can count a group's seats, so two students taking the last one at
   * the same moment would both pass a check-then-insert and leave a topic for
   * three with four students on it. `FOR UPDATE` serialises exactly the callers
   * contending for this one group and nothing else.
   */
  private async addMember(
    groupId: number,
    student: { id: number; fullName: string },
    joinSource: GroupJoinSource,
    options: { allowHeldSeats: boolean },
  ) {
    const studentId = student.id;

    const audience = await this.prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "registration_groups" WHERE "id" = ${groupId} FOR UPDATE`;

        // Re-read inside the lock: the counts checked before it was taken are
        // exactly the ones another request may have moved.
        const group = await tx.registrationGroup.findUnique({
          where: { id: groupId },
          select: GROUP_SELECT,
        });

        if (!group || group.status === RegistrationGroupStatus.REJECTED) {
          throw new NotFoundException('Registration group not found');
        }

        if (group.members.some((member) => member.studentId === studentId)) {
          throw new ConflictException('You are already in this group');
        }

        if (!group.openForJoin) {
          throw new ConflictException(
            'This group has closed itself to new members',
          );
        }

        const seats = seatBreakdown(group);

        if (seats.occupied >= seats.capacity) {
          throw new ConflictException('This group is already full');
        }

        if (!options.allowHeldSeats && seats.freeToAnyone === 0) {
          throw new ConflictException(
            'The remaining seats are being held for members the leader has invited — ask them for the join link',
          );
        }

        await tx.registrationGroupMember.create({
          data: {
            groupId,
            semesterId: group.semesterId,
            studentId,
            status: GroupMemberStatus.ACCEPTED,
            joinSource,
            joinedAt: new Date(),
          },
        });

        await this.syncStatus(tx, groupId, seats.capacity);

        // Gathered while the row is still locked, so the list is exactly who was
        // in the group at the moment this student joined it.
        return {
          userIds: group.members.map((member) => member.student.user.id),
          topicTitle: group.topic.title,
        };
      })
      .catch((err: unknown) => {
        throw this.translateRegistrationConflict(err);
      });

    await this.notifications.notify(
      audience.userIds.map((userId) => ({
        userId,
        type: NotificationType.GROUP_MEMBER_JOINED,
        title: 'Có người tham gia nhóm của bạn',
        content: `${student.fullName} vừa vào nhóm đề tài "${audience.topicTitle}".`,
        targetId: groupId,
      })),
    );

    return this.present(groupId, { studentId });
  }

  /** Reload and shape a group for the student who just changed it. */
  private async present(id: number, viewer: { studentId: number }) {
    const group = await this.loadGroup(id);

    return this.render(group, {
      studentId: viewer.studentId,
      lecturerId: null,
      role: Role.STUDENT,
    });
  }

  private async loadGroup(id: number): Promise<GroupRow> {
    const group = await this.prisma.registrationGroup.findUnique({
      where: { id },
      select: GROUP_SELECT,
    });

    if (!group) throw new NotFoundException('Registration group not found');

    return group;
  }

  /**
   * Shapes a group for one particular reader.
   *
   * The join code is the only field that varies: it is a secret that keeps a
   * stranger out of a held seat, so handing it to a stranger would undo the
   * mechanism it protects.
   */
  private render(group: GroupRow, viewer: Viewer) {
    const seats = seatBreakdown(group);
    const { joinCode, members, topic, ...rest } = group;
    const { round, ...topicRest } = topic;
    const isMember = members.some(
      (member) => member.studentId === viewer.studentId,
    );

    return {
      ...rest,
      // Flattened back to the shape callers already read: the kind of project
      // reaches the topic through its round now, and which table it came from is
      // not the client's problem.
      topic: { ...topicRest, projectType: round.projectType },
      members: members.map((member) => {
        const { user, ...student } = member.student;

        return {
          id: member.id,
          joinSource: member.joinSource,
          joinedAt: member.joinedAt,
          isLeader: member.studentId === group.leaderId,
          // The avatar is lifted onto the student the same way the address is:
          // it is stored against the account, but to this screen it is simply
          // what this person looks like.
          student: { ...student, email: user.email, avatarUrl: user.avatarUrl },
        };
      }),
      occupiedSeats: seats.occupied,
      heldSeats: seats.held,
      seatsOpenToAnyone: seats.freeToAnyone,
      isFull: seats.occupied >= seats.capacity,
      holdActive: seats.holdActive,
      isLeader: group.leaderId === viewer.studentId,
      joinCode: isMember ? joinCode : null,
    };
  }

  private canView(group: GroupRow, viewer: Viewer): boolean {
    if (viewer.role === Role.ADMIN) return true;
    if (viewer.lecturerId && group.topic.lecturerId === viewer.lecturerId) {
      return true;
    }

    return group.members.some(
      (member) => member.studentId === viewer.studentId,
    );
  }

  private async resolveViewer(userId: number, role: Role): Promise<Viewer> {
    if (role === Role.STUDENT) {
      const profile = await this.prisma.studentProfile.findUnique({
        where: { userId },
        select: { id: true },
      });

      return { studentId: profile?.id ?? null, lecturerId: null, role };
    }

    if (role === Role.LECTURER) {
      const profile = await this.prisma.lecturerProfile.findUnique({
        where: { userId },
        select: { id: true },
      });

      return { studentId: null, lecturerId: profile?.id ?? null, role };
    }

    return { studentId: null, lecturerId: null, role };
  }

  private async requireLeadership(id: number, studentId: number) {
    const group = await this.loadGroup(id);

    if (group.status === RegistrationGroupStatus.REJECTED) {
      throw new ConflictException('This group has already been disbanded');
    }

    if (group.leaderId !== studentId) {
      throw new ForbiddenException('Only the group leader can do that');
    }

    return group;
  }

  /**
   * Registration hangs off StudentProfile, not User: an account with no profile
   * is half-created rather than authorised, and every downstream relation —
   * membership, grades, defence — points at the profile.
   */
  /**
   * Refuses early if this student already belongs to a group this semester.
   *
   * The database enforces the rule regardless — that is what makes it hold when
   * a thousand students press the same button at once — but a stale browser tab
   * is far commoner than a race, and reaching the constraint means the message
   * has to be reconstructed from a driver error. Asking first gives the ordinary
   * case a plain answer and leaves the index doing what only it can.
   */
  private async requireNoExistingGroup(studentId: number, semesterId: number) {
    const existing = await this.prisma.registrationGroupMember.findFirst({
      where: {
        studentId,
        semesterId,
        status: GroupMemberStatus.ACCEPTED,
        group: { status: { not: RegistrationGroupStatus.REJECTED } },
      },
      select: {
        group: { select: { id: true, topic: { select: { title: true } } } },
      },
    });

    if (existing) {
      throw new ConflictException(
        `You are already in a group this semester, on "${existing.group.topic.title}" — leave it before taking another topic`,
      );
    }
  }

  private async requireGroupByCode(joinCode: string) {
    const group = await this.prisma.registrationGroup.findUnique({
      where: { joinCode },
      select: GROUP_SELECT,
    });

    // A disbanded group answers the same as an unknown code. The link is dead
    // either way, and distinguishing them would tell a stranger holding a stale
    // link that it was once real.
    if (!group || group.status === RegistrationGroupStatus.REJECTED) {
      throw new NotFoundException('This invite link is no longer valid');
    }

    return group;
  }

  /**
   * Every rule standing between a student and a group, in one place.
   *
   * Shared by the join endpoints and by the preview so the two cannot drift.
   * The seat checks here are advisory — `addMember` repeats them holding a row
   * lock, which is the only place they are authoritative — but running them now
   * turns "full" into a plain answer rather than something reconstructed after a
   * transaction has already rolled back.
   */
  private async assertJoinable(
    group: GroupRow,
    student: { id: number; cohort: string | null },
    options: { allowHeldSeats: boolean },
  ) {
    await this.phases.requireCanJoin(group.topic.roundId, student.id);

    const topic = await this.requireRegistrableTopic(group.topicId);
    await this.requireEligible(topic, student.cohort);
    await this.requireNoExistingGroup(student.id, group.semesterId);

    if (!group.openForJoin) {
      throw new ConflictException(
        'This group has closed itself to new members',
      );
    }

    const seats = seatBreakdown(group);

    if (seats.occupied >= seats.capacity) {
      throw new ConflictException('This group is already full');
    }

    if (!options.allowHeldSeats && seats.freeToAnyone === 0) {
      throw new ConflictException(
        'The remaining seats are being held for members the leader has invited — ask them for the join link',
      );
    }
  }

  private async requireStudent(userId: number) {
    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { id: true, cohort: true, fullName: true },
    });

    if (!profile) {
      throw new ForbiddenException(
        'No student profile is attached to this account',
      );
    }

    return profile;
  }

  private async requireRegistrableTopic(id: number) {
    const topic = await this.prisma.topic.findUnique({
      where: { id },
      select: {
        id: true,
        semesterId: true,
        roundId: true,
        maxStudents: true,
        status: true,
        round: { select: { projectType: { select: { name: true } } } },
      },
    });

    if (!topic) throw new NotFoundException('Topic not found');

    if (topic.status !== TopicStatus.OPEN) {
      throw new ConflictException(
        'This topic is not open for registration at the moment',
      );
    }

    return topic;
  }

  /**
   * Whether this student's intake may take this kind of project this semester.
   *
   * Checked here and not only in the interface, because the browse screen's
   * default filter is a convenience and this is the rule.
   */
  private async requireEligible(
    topic: { roundId: number; round: { projectType: { name: string } } },
    cohort: string | null,
  ) {
    if (!cohort) {
      throw new ForbiddenException(
        'This account has no intake year on file, so eligibility cannot be established',
      );
    }

    const match = await this.prisma.roundEligibility.findFirst({
      where: { roundId: topic.roundId, cohort },
      select: { id: true },
    });

    if (match) return;

    // Told apart because they call for different action: one is a student
    // looking at the wrong kind of project, the other is the faculty office not
    // having declared anything yet, and answering both with "you are not
    // eligible" sends the wrong person looking for the fault.
    const anyRule = await this.prisma.roundEligibility.findFirst({
      where: { roundId: topic.roundId },
      select: { id: true },
    });

    if (!anyRule) {
      throw new ConflictException(
        'The faculty office has not yet declared which intakes may take part in this round',
      );
    }

    throw new ForbiddenException(
      `${topic.round.projectType.name} is not open to intake ${cohort} this semester`,
    );
  }

  private async requireActiveSemesterId() {
    const semester = await this.prisma.semester.findFirst({
      where: { isActive: true },
      select: { id: true },
    });

    if (!semester) {
      throw new NotFoundException('No semester is currently active');
    }

    return semester.id;
  }

  /**
   * Turns the two partial unique indexes into answers a student can act on.
   *
   * Both are enforced by the database rather than by a count, which is what
   * makes them correct when a thousand students press the same button in the
   * same second — but P2002 says only that something was unique, so the index
   * name is what distinguishes "somebody beat you to this topic" from "you are
   * already in a group".
   */
  private translateRegistrationConflict(err: unknown): unknown {
    if (!isUniqueViolation(err)) return err;

    const target = uniqueConstraintName(err);

    if (target.includes('one_live_per_topic')) {
      return new ConflictException(
        'Another group has just taken this topic — pick another one',
      );
    }

    if (target.includes('one_accepted_per_semester')) {
      return new ConflictException(
        'You are already in a group this semester — leave it before taking another topic',
      );
    }

    return new ConflictException(
      'That registration collided with another one — reload and try again',
    );
  }
}
