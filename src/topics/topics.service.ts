import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GroupMemberStatus,
  Prisma,
  RegistrationGroupStatus,
  Role,
  SemesterPhase,
  TopicStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SemesterPhaseService } from '../semesters/semester-phase.service';
import { CreateTopicDto } from './dto/create-topic.dto';
import { QueryTopicsDto } from './dto/query-topics.dto';
import { UpdateTopicDto } from './dto/update-topic.dto';

/**
 * The statuses a topic reaches only after it has been published to students.
 * PENDING and APPROVED are drafts as far as a student is concerned: the first
 * is waiting on the faculty office, the second is approved but not yet opened
 * for registration by its lecturer.
 */
const PUBLISHED_STATUSES = [
  TopicStatus.OPEN,
  TopicStatus.IN_PROGRESS,
  TopicStatus.COMPLETED,
] as const;

/**
 * The one group that currently holds a topic, if any.
 *
 * A plain count of registration_groups is the wrong question. At most one group
 * can be live on a topic — so a count can only ever be nought or one — and
 * REJECTED rows are kept on purpose for the record, which means counting them
 * reports groups that walked away as though they were still there.
 *
 * Seats are simply the members: joining is one action now, so a row exists only
 * once somebody is actually in. `openForJoin` and `holdUntil` come along because
 * a seat being unoccupied is not the same as a seat being available to the person
 * looking at it.
 */
const ACTIVE_GROUP_SELECT = {
  where: { status: { not: RegistrationGroupStatus.REJECTED } },
  select: {
    id: true,
    status: true,
    openForJoin: true,
    declaredSize: true,
    holdUntil: true,
    _count: {
      select: { members: { where: { status: GroupMemberStatus.ACCEPTED } } },
    },
  },
  take: 1,
} satisfies Prisma.Topic$registrationGroupsArgs;

/** List rows carry no long-text bodies — those belong to the detail view. */
const LIST_SELECT = {
  id: true,
  title: true,
  maxStudents: true,
  status: true,
  createdAt: true,
  semester: { select: { id: true, name: true, code: true } },
  projectType: { select: { id: true, name: true, code: true } },
  lecturer: { select: { id: true, fullName: true, academicTitle: true } },
  registrationGroups: ACTIVE_GROUP_SELECT,
} satisfies Prisma.TopicSelect;

type TopicWithGroups = {
  maxStudents: number;
  registrationGroups: {
    id: number;
    status: RegistrationGroupStatus;
    openForJoin: boolean;
    declaredSize: number | null;
    holdUntil: Date | null;
    _count: { members: number };
  }[];
};

/**
 * Flattens the at-most-one live group into fields the client can read directly,
 * including which of the two buttons to offer.
 *
 * An array of one is an implementation detail of how the constraint is
 * expressed, not something every caller should have to unwrap. Nor should the
 * browse screen have to reimplement the seat arithmetic: getting it wrong there
 * means offering a seat that the API will then refuse.
 */
function withActiveGroup<T extends TopicWithGroups>(
  topic: T,
  /**
   * The semester's phase, when the caller knows it.
   *
   * Both booleans are false outside OPEN, because "can" has to mean the same
   * thing the API means. Reporting a topic as registrable while the gate is shut
   * would put a live button in front of a request that is certain to be refused —
   * and the browse screen has no way to know better, since availability is
   * exactly what it is asking this endpoint for.
   */
  phase?: SemesterPhase,
) {
  const { registrationGroups, ...rest } = topic;
  const group = registrationGroups[0];
  const gateOpen = phase === undefined || phase === SemesterPhase.OPEN;

  if (!group) {
    return {
      ...rest,
      activeGroup: null,
      occupiedSeats: 0,
      isFull: false,
      /** Nobody holds it: the first student to press register takes it. */
      canRegister: gateOpen,
      canJoin: false,
    };
  }

  const occupied = group._count.members;
  const full = occupied >= topic.maxStudents;
  const holding = group.holdUntil !== null && group.holdUntil > new Date();

  // Seats above the declared size were never the leader's to keep, so a group of
  // two on a topic for three does not get to sit on the third place.
  const held =
    holding && group.declaredSize
      ? Math.max(0, Math.min(group.declaredSize, topic.maxStudents) - occupied)
      : 0;

  return {
    ...rest,
    activeGroup: {
      id: group.id,
      status: group.status,
      occupiedSeats: occupied,
      openForJoin: group.openForJoin,
      /**
       * True while seats are being kept for people the leader is bringing. The
       * interface should say "taken" here rather than "one seat left", because a
       * seat with somebody's name on it is not free.
       */
      holdActive: holding,
    },
    occupiedSeats: occupied,
    isFull: full,
    canRegister: false,
    canJoin:
      gateOpen &&
      !full &&
      group.openForJoin &&
      topic.maxStudents - occupied - held > 0,
  };
}

/**
 * The detail view deliberately exposes no contact details for the lecturer.
 * A student browsing topics needs to know who supervises it, not their email
 * or phone number, and this endpoint is readable by every signed-in student.
 */
const DETAIL_INCLUDE = {
  semester: {
    select: {
      id: true,
      name: true,
      code: true,
      registrationStart: true,
      registrationEnd: true,
    },
  },
  projectType: { select: { id: true, name: true, code: true } },
  lecturer: {
    select: {
      id: true,
      fullName: true,
      lecturerCode: true,
      academicTitle: true,
    },
  },
  registrationGroups: ACTIVE_GROUP_SELECT,
} satisfies Prisma.TopicInclude;

@Injectable()
export class TopicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phases: SemesterPhaseService,
  ) {}

  async findAll(query: QueryTopicsDto, userId: number, role: Role) {
    const where: Prisma.TopicWhereInput = {
      status: visibleStatusFilter(role, query.status),
    };

    if (query.semesterId) where.semesterId = query.semesterId;
    if (query.projectTypeId) where.projectTypeId = query.projectTypeId;

    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    if (query.mine) {
      if (role !== Role.LECTURER) {
        throw new ForbiddenException('Only lecturers own topics');
      }
      where.lecturerId = await this.requireLecturerProfileId(userId);
    } else if (query.lecturerId) {
      where.lecturerId = query.lecturerId;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.topic.findMany({
        where,
        select: LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.topic.count({ where }),
    ]);

    // Resolved rather than read off the joined row, so that a gate which closed
    // a minute ago is closed here too — the phase advances on being asked, and a
    // page of buttons is a bad place to be the last to find out. One lookup per
    // distinct semester, which on this screen is almost always one.
    const phases = await this.resolvePhases(
      items.map((topic) => topic.semester.id),
    );

    return {
      items: items.map((topic) =>
        withActiveGroup(topic, phases.get(topic.semester.id)),
      ),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  private async resolvePhases(semesterIds: number[]) {
    const distinct = [...new Set(semesterIds)];
    const resolved = await Promise.all(
      distinct.map(async (id) => [id, await this.phases.resolve(id)] as const),
    );

    return new Map(resolved);
  }

  /**
   * The lecturers a caller could usefully filter by — those who actually have
   * a topic this caller can see, rather than every lecturer in the faculty.
   *
   * It lives here rather than on /users for two reasons. Listing accounts is
   * admin-only and should stay that way: a student has no business enumerating
   * staff records. And a filter offering names with nothing behind them is
   * worse than no filter, because every one of those choices leads to an empty
   * page.
   */
  async findLecturers(role: Role, semesterId?: number) {
    const rows = await this.prisma.topic.findMany({
      where: {
        status: visibleStatusFilter(role, undefined),
        ...(semesterId && { semesterId }),
      },
      select: {
        lecturer: { select: { id: true, fullName: true, academicTitle: true } },
      },
      distinct: ['lecturerId'],
      orderBy: { lecturer: { fullName: 'asc' } },
    });

    return rows.map((row) => row.lecturer);
  }

  async findOne(id: number, role: Role) {
    const topic = await this.prisma.topic.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });

    // Knowing the id is not a bypass. An unpublished topic answers 404 rather
    // than 403 for a student, so the response cannot be used to map out which
    // drafts exist.
    if (!topic || !canSee(topic.status, role)) {
      throw new NotFoundException('Topic not found');
    }

    // The gate is the semester's phase, and only the phase. Comparing the dates
    // here as well would quietly overrule an office that opened registration
    // early or held it shut, which the phase exists to let them do.
    const phase = await this.phases.resolve(topic.semesterId);

    return {
      ...withActiveGroup(topic),
      semesterPhase: phase,
      // Saves the client a second request to the semester just to decide whether
      // the register button should be live.
      isRegistrationOpen:
        topic.status === TopicStatus.OPEN && phase === SemesterPhase.OPEN,
    };
  }

  async create(dto: CreateTopicDto, userId: number) {
    const lecturerId = await this.requireLecturerProfileId(userId);

    // Checked up front so a bad reference reads as a 404 on the field the
    // caller got wrong, rather than a raw foreign-key violation.
    await this.requireSemester(dto.semesterId);
    await this.requireProjectType(dto.projectTypeId);

    const topic = await this.prisma.topic.create({
      data: { ...dto, lecturerId },
      include: DETAIL_INCLUDE,
    });

    return withActiveGroup(topic);
  }

  async update(id: number, dto: UpdateTopicDto, userId: number, role: Role) {
    const topic = await this.requireOwnTopic(id, userId, role);

    if (
      topic.status === TopicStatus.IN_PROGRESS ||
      topic.status === TopicStatus.COMPLETED
    ) {
      throw new ConflictException(
        'A topic already under way can no longer be edited',
      );
    }

    if (dto.projectTypeId) await this.requireProjectType(dto.projectTypeId);

    const updated = await this.prisma.topic.update({
      where: { id },
      data: dto,
      include: DETAIL_INCLUDE,
    });

    return withActiveGroup(updated);
  }

  async remove(id: number, userId: number, role: Role) {
    const topic = await this.requireOwnTopic(id, userId, role);

    // Only a group that is still standing blocks deletion. REJECTED rows are
    // kept for the record, and counting them would leave a topic that everyone
    // walked away from permanently undeletable — while the unique index says
    // it is free for the next student to take.
    if (topic.activeGroupCount > 0) {
      throw new ConflictException(
        'Cannot delete a topic that students have already registered for',
      );
    }

    await this.prisma.topic.delete({ where: { id } });

    return { message: 'Topic deleted' };
  }

  /** Faculty office sign-off: the draft becomes a real topic. */
  async approve(id: number) {
    const topic = await this.requireTopic(id);

    if (topic.status !== TopicStatus.PENDING) {
      throw new ConflictException('Only a pending topic can be approved');
    }

    return this.setStatus(id, TopicStatus.APPROVED);
  }

  /** The lecturer decides when an approved topic starts taking registrations. */
  async open(id: number, userId: number, role: Role) {
    const topic = await this.requireOwnTopic(id, userId, role);

    if (topic.status !== TopicStatus.APPROVED) {
      throw new ConflictException(
        'A topic must be approved before it can accept registrations',
      );
    }

    return this.setStatus(id, TopicStatus.OPEN);
  }

  /** Stops new registrations without withdrawing the topic altogether. */
  async close(id: number, userId: number, role: Role) {
    const topic = await this.requireOwnTopic(id, userId, role);

    if (topic.status !== TopicStatus.OPEN) {
      throw new ConflictException('Only an open topic can be closed');
    }

    return this.setStatus(id, TopicStatus.APPROVED);
  }

  private async setStatus(id: number, status: TopicStatus) {
    const topic = await this.prisma.topic.update({
      where: { id },
      data: { status },
      include: DETAIL_INCLUDE,
    });

    return withActiveGroup(topic);
  }

  private async requireTopic(id: number) {
    const topic = await this.prisma.topic.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        lecturerId: true,
        _count: {
          select: {
            registrationGroups: {
              where: { status: { not: RegistrationGroupStatus.REJECTED } },
            },
          },
        },
      },
    });

    if (!topic) throw new NotFoundException('Topic not found');

    return { ...topic, activeGroupCount: topic._count.registrationGroups };
  }

  /**
   * Role alone is not authorisation. Being a LECTURER lets you edit *a* topic;
   * owning this one is what lets you edit *this* topic. Admins are exempt
   * because the faculty office has to be able to clean up after a lecturer who
   * has left.
   */
  private async requireOwnTopic(id: number, userId: number, role: Role) {
    const topic = await this.requireTopic(id);

    if (role === Role.ADMIN) return topic;

    const lecturerId = await this.requireLecturerProfileId(userId);

    if (topic.lecturerId !== lecturerId) {
      throw new ForbiddenException('This topic belongs to another lecturer');
    }

    return topic;
  }

  /**
   * Topics hang off LecturerProfile, not User, so a LECTURER account with no
   * profile row cannot own one — an account in that state is half-created
   * rather than authorised.
   */
  private async requireLecturerProfileId(userId: number) {
    const profile = await this.prisma.lecturerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!profile) {
      throw new ForbiddenException(
        'No lecturer profile is attached to this account',
      );
    }

    return profile.id;
  }

  private async requireSemester(id: number) {
    const semester = await this.prisma.semester.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!semester) throw new NotFoundException(`Semester ${id} not found`);
  }

  private async requireProjectType(id: number) {
    const projectType = await this.prisma.projectType.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!projectType)
      throw new NotFoundException(`Project type ${id} not found`);
  }
}

/**
 * Staff see every status; a student sees only what has been published, and a
 * `?status=PENDING` from a student narrows within that set rather than
 * escaping it.
 */
function visibleStatusFilter(
  role: Role,
  requested: TopicStatus | undefined,
): Prisma.EnumTopicStatusFilter | undefined {
  if (role !== Role.STUDENT) {
    return requested ? { equals: requested } : undefined;
  }

  if (requested && !canSee(requested, role)) {
    // Asking for drafts as a student is answered with an empty page, not an
    // error: the filter is a view, and nothing here is worth confirming.
    return { in: [] };
  }

  return requested ? { equals: requested } : { in: [...PUBLISHED_STATUSES] };
}

function canSee(status: TopicStatus, role: Role): boolean {
  if (role !== Role.STUDENT) return true;

  return (PUBLISHED_STATUSES as readonly TopicStatus[]).includes(status);
}
