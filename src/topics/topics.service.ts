import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, TopicStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
  _count: { select: { registrationGroups: true } },
} satisfies Prisma.TopicSelect;

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
  _count: { select: { registrationGroups: true } },
} satisfies Prisma.TopicInclude;

@Injectable()
export class TopicsService {
  constructor(private readonly prisma: PrismaService) {}

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

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
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

    return {
      ...topic,
      // The registration window lives on the semester, so the client would
      // otherwise have to fetch it separately just to know whether to enable
      // the register button.
      isRegistrationOpen:
        topic.status === TopicStatus.OPEN &&
        isWithinWindow(
          topic.semester.registrationStart,
          topic.semester.registrationEnd,
        ),
    };
  }

  async create(dto: CreateTopicDto, userId: number) {
    const lecturerId = await this.requireLecturerProfileId(userId);

    // Checked up front so a bad reference reads as a 404 on the field the
    // caller got wrong, rather than a raw foreign-key violation.
    await this.requireSemester(dto.semesterId);
    await this.requireProjectType(dto.projectTypeId);

    return this.prisma.topic.create({
      data: { ...dto, lecturerId },
      include: DETAIL_INCLUDE,
    });
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

    return this.prisma.topic.update({
      where: { id },
      data: dto,
      include: DETAIL_INCLUDE,
    });
  }

  async remove(id: number, userId: number, role: Role) {
    const topic = await this.requireOwnTopic(id, userId, role);

    if (topic._count.registrationGroups > 0) {
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

  private setStatus(id: number, status: TopicStatus) {
    return this.prisma.topic.update({
      where: { id },
      data: { status },
      include: DETAIL_INCLUDE,
    });
  }

  private async requireTopic(id: number) {
    const topic = await this.prisma.topic.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        lecturerId: true,
        _count: { select: { registrationGroups: true } },
      },
    });

    if (!topic) throw new NotFoundException('Topic not found');

    return topic;
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

function isWithinWindow(start: Date, end: Date): boolean {
  const now = Date.now();

  return now >= start.getTime() && now <= end.getTime();
}
