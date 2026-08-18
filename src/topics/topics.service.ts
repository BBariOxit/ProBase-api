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
  RoundPhase,
  TopicStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RoundPhaseService } from '../rounds/round-phase.service';
import { RoundsService } from '../rounds/rounds.service';
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

/**
 * The round a topic sits in, and through it the kind of project.
 *
 * The type is not on the topic any more: a topic belongs to a round, and the
 * round is a semester crossed with a kind of project. Carrying the type in both
 * places would be two sources for one fact. Clients still read `projectType` at
 * the top level — the shape is restored on the way out, because a caller has no
 * business knowing which table the answer came from.
 */
const ROUND_SELECT = {
  select: {
    id: true,
    phase: true,
    registrationStart: true,
    registrationEnd: true,
    projectType: { select: { id: true, name: true, code: true } },
  },
} satisfies Prisma.RegistrationRoundDefaultArgs;

/** List rows carry no long-text bodies — those belong to the detail view. */
const LIST_SELECT = {
  id: true,
  title: true,
  maxStudents: true,
  status: true,
  createdAt: true,
  semester: { select: { id: true, name: true, code: true } },
  round: ROUND_SELECT,
  lecturer: { select: { id: true, fullName: true, academicTitle: true } },
  registrationGroups: ACTIVE_GROUP_SELECT,
  // Only the id of whoever proposed it. A topic born from a proposal is
  // reserved for that student while the gate is open, and a screen that does
  // not know it would draw a register button the API refuses.
  sourceProposal: { select: { studentId: true } },
} satisfies Prisma.TopicSelect;

type TopicRound = {
  id: number;
  phase: RoundPhase;
  registrationStart: Date;
  registrationEnd: Date;
  projectType: { id: number; name: string; code: string };
};

type TopicWithGroups = {
  maxStudents: number;
  round: TopicRound;
  sourceProposal: { studentId: number } | null;
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
   * The round's phase as of now, which is not always the one on the row: it
   * advances when somebody asks, and this endpoint is the asking.
   */
  phase: RoundPhase,
  /**
   * What this particular caller may do, when the caller is known.
   *
   * Both booleans mean "the API would accept this from you", not "a seat exists"
   * — so everything the register endpoint checks has to be reflected here.
   * Anything less puts a live button in front of a request certain to be refused,
   * and the browse screen has no way to know better, since availability is
   * exactly what it is asking this endpoint for.
   */
  viewer?: {
    gateOpen: boolean;
    eligible: boolean;
    hasGroup: boolean;
    /** The topic came out of somebody else's proposal, so it is not on offer. */
    reservedForOther: boolean;
  },
) {
  const { registrationGroups, round, sourceProposal, ...rest } = topic;
  const group = registrationGroups[0];
  const allowed =
    viewer === undefined ||
    (viewer.gateOpen &&
      viewer.eligible &&
      !viewer.hasGroup &&
      !viewer.reservedForOther);

  /**
   * Two facts rather than one, because they are read by different sentences.
   *
   * `fromProposal` is about the topic and is true for everybody — it is why the
   * topic exists. `proposedByMe` is about the reader, and it is the difference
   * between "Đề tài bạn đề xuất" and "do sinh viên khác đề xuất": with only the
   * first flag a screen would have to describe someone else's reservation and
   * the reader's own entitlement in the same words.
   */
  const fromProposal = sourceProposal !== null;
  const proposedByMe =
    viewer === undefined || !fromProposal ? null : !viewer.reservedForOther;

  /**
   * Flattened back to the shape callers already read. `round` comes along
   * because the dates and the phase live there now, and a screen counting down
   * to the deadline has to count down to the right one — a semester running Cơ
   * sở and Tốt nghiệp closes them on different days.
   */
  const placement = {
    projectTypeId: round.projectType.id,
    projectType: round.projectType,
    round: {
      id: round.id,
      phase,
      registrationStart: round.registrationStart,
      registrationEnd: round.registrationEnd,
    },
  };

  /**
   * Whether this caller's intake may take this kind of project, or null when the
   * question does not apply to them.
   *
   * Sent separately from the two booleans because "you cannot have this" and
   * "somebody else has this" are different facts, and a screen with only
   * canRegister/canJoin to go on cannot tell them apart — it would end up calling
   * an unclaimed topic taken.
   */
  const eligibleForMe = viewer?.eligible ?? null;

  /**
   * Whether this reader already holds a place this semester, or null when the
   * question does not apply to them.
   *
   * Sent because it is the other reason `canRegister` can be false while a topic
   * sits there plainly unclaimed. Without it a screen can only grey the button
   * out and say nothing, and the student reads that as the system being broken
   * rather than as them already having what the button offers.
   */
  const alreadyInAGroup = viewer?.hasGroup ?? null;

  if (!group) {
    return {
      ...rest,
      ...placement,
      activeGroup: null,
      occupiedSeats: 0,
      isFull: false,
      /** Nobody holds it: the first student to press register takes it. */
      canRegister: allowed,
      canJoin: false,
      eligibleForMe,
      alreadyInAGroup,
      fromProposal,
      proposedByMe,
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
    ...placement,
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
      allowed &&
      !full &&
      group.openForJoin &&
      topic.maxStudents - occupied - held > 0,
    eligibleForMe,
    alreadyInAGroup,
    fromProposal,
    proposedByMe,
  };
}

/**
 * The detail view deliberately exposes no contact details for the lecturer.
 * A student browsing topics needs to know who supervises it, not their email
 * or phone number, and this endpoint is readable by every signed-in student.
 */
const DETAIL_INCLUDE = {
  semester: { select: { id: true, name: true, code: true } },
  round: ROUND_SELECT,
  lecturer: {
    select: {
      id: true,
      fullName: true,
      lecturerCode: true,
      academicTitle: true,
    },
  },
  registrationGroups: ACTIVE_GROUP_SELECT,
  sourceProposal: { select: { studentId: true } },
} satisfies Prisma.TopicInclude;

@Injectable()
export class TopicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phases: RoundPhaseService,
    private readonly rounds: RoundsService,
  ) {}

  async findAll(query: QueryTopicsDto, userId: number, role: Role) {
    const where: Prisma.TopicWhereInput = {
      status: visibleStatusFilter(role, query.status),
    };

    if (query.semesterId) where.semesterId = query.semesterId;
    // Still asked for by kind of project, which is what a reader picks from a
    // menu — the round it implies is this layer's problem, not theirs.
    if (query.projectTypeId) {
      where.round = { projectTypeId: query.projectTypeId };
    }

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

    if (query.forMyCohort) {
      where.roundId = { in: await this.rounds.eligibleRoundIds(userId) };
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

    const phases = await this.resolveRoundPhases(items);
    const viewers = await this.availabilityFor(items, userId, role, phases);

    return {
      items: items.map((topic) =>
        withActiveGroup(
          topic,
          phases.get(topic.round.id) ?? topic.round.phase,
          viewers(topic),
        ),
      ),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  /**
   * Brings every round on the page up to date, once per round rather than once
   * per topic.
   *
   * A page of twenty topics is usually two or three rounds, and the phase
   * advances on being asked — so asking per row would be twenty reads and, worse,
   * twenty chances to write the same advance.
   */
  private resolveRoundPhases(items: { round: TopicRound }[]) {
    const unique = new Map(items.map((topic) => [topic.round.id, topic.round]));

    return this.phases.resolveMany([...unique.values()]);
  }

  /**
   * Builds the per-topic answer to "would the API accept a registration from
   * this caller", in two queries rather than two per row.
   *
   * Staff get no answer at all — `undefined` leaves the flags describing the
   * topic rather than a viewer, because a lecturer reading their own list is not
   * a candidate for a seat and blanking the fields would just look broken.
   */
  private async availabilityFor(
    items: {
      semester: { id: number };
      round: TopicRound;
      sourceProposal: { studentId: number } | null;
    }[],
    userId: number,
    role: Role,
    phases: Map<number, RoundPhase>,
  ) {
    if (role !== Role.STUDENT || items.length === 0) return () => undefined;

    const semesterIds = [...new Set(items.map((topic) => topic.semester.id))];

    // Read once for the page rather than per row. Null only for an account with
    // no student profile, which the role check above nearly rules out — and a
    // null can match no proposal, so every reserved topic reads as somebody
    // else's, which is the safe direction to be wrong in.
    const me = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    const eligible = new Set(
      await this.rounds.eligibleRoundIds(userId, semesterIds),
    );

    // A student who is already in a group cannot take another topic — one group
    // per semester, enforced by the database. Without this the browse screen
    // would offer a register button to everyone who already has a place, which
    // is nearly the whole cohort once an extension is running.
    const taken = await this.semestersWhereIHaveAGroup(userId, semesterIds);

    return (topic: {
      semester: { id: number };
      round: TopicRound;
      sourceProposal: { studentId: number } | null;
    }) => {
      const phase = phases.get(topic.round.id) ?? topic.round.phase;

      return {
        // An extension reopens the gate, so it counts as open here — what stops
        // it applying to a student who already has a group is `hasGroup`, which
        // is the same rule the register endpoint enforces.
        gateOpen: phase === RoundPhase.OPEN || phase === RoundPhase.EXTENDED,
        // The register endpoint refuses a round the caller's intake is not open
        // for, so a button offering it here would be a button that lies.
        eligible: eligible.has(topic.round.id),
        hasGroup: taken.has(topic.semester.id),
        // A topic written out of a proposal is that student's until the gate
        // shuts; to everybody else it is not on offer, and the register
        // endpoint refuses it for the same reason.
        reservedForOther:
          topic.sourceProposal !== null &&
          topic.sourceProposal.studentId !== me?.id,
      };
    };
  }

  private async semestersWhereIHaveAGroup(
    userId: number,
    semesterIds: number[],
  ) {
    const rows = await this.prisma.registrationGroupMember.findMany({
      where: {
        student: { userId },
        semesterId: { in: semesterIds },
        status: GroupMemberStatus.ACCEPTED,
        group: { status: { not: RegistrationGroupStatus.REJECTED } },
      },
      select: { semesterId: true },
    });

    return new Set(rows.map((row) => row.semesterId));
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

  async findOne(id: number, userId: number, role: Role) {
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

    // The gate is the round's phase, and only the phase. Comparing the dates
    // here as well would quietly overrule an office that opened registration
    // early or held it shut, which the phase exists to let them do.
    const phases = await this.resolveRoundPhases([topic]);
    const phase = phases.get(topic.round.id) ?? topic.round.phase;
    const viewer = await this.availabilityFor([topic], userId, role, phases);

    return {
      ...withActiveGroup(topic, phase, viewer(topic)),
      roundPhase: phase,
      // Saves the client a second request to the round just to decide whether
      // the register button should be live. This one is about the topic and the
      // calendar only — whether *this* caller may take it is canRegister/canJoin.
      // An extension counts as open: it is a gate somebody may still walk
      // through, even though not everybody.
      isRegistrationOpen:
        topic.status === TopicStatus.OPEN &&
        (phase === RoundPhase.OPEN || phase === RoundPhase.EXTENDED),
    };
  }

  async create(dto: CreateTopicDto, userId: number) {
    const lecturerId = await this.requireLecturerProfileId(userId);

    // Checked up front so a bad reference reads as a 404 on the field the
    // caller got wrong, rather than a raw foreign-key violation. Choosing a kind
    // of project is choosing the round, and one the faculty has not opened is
    // refused here rather than left in the catalogue for students to bounce off.
    await this.requireSemester(dto.semesterId);
    const { semesterId, projectTypeId, ...rest } = dto;
    const round = await this.rounds.requireRoundFor(semesterId, projectTypeId);

    const topic = await this.prisma.topic.create({
      data: { ...rest, semesterId, roundId: round.id, lecturerId },
      include: DETAIL_INCLUDE,
    });

    return this.presentDetail(topic);
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

    const { projectTypeId, ...rest } = dto;

    // Moving a topic to another kind of project moves it to another round, and
    // only within its own semester — the composite foreign key would refuse
    // anything else, and a clear 409 beats a driver error.
    const roundId = projectTypeId
      ? (await this.rounds.requireRoundFor(topic.semesterId, projectTypeId)).id
      : undefined;

    const updated = await this.prisma.topic.update({
      where: { id },
      data: { ...rest, ...(roundId !== undefined && { roundId }) },
      include: DETAIL_INCLUDE,
    });

    return this.presentDetail(updated);
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

    return this.presentDetail(topic);
  }

  /**
   * A single topic, with its round's phase brought up to date rather than read
   * off the row. Every write path returns through here, and a response that
   * reported a gate as open a minute after it shut would be the one place a
   * client had no reason to doubt.
   */
  private async presentDetail<T extends TopicWithGroups>(topic: T) {
    const phases = await this.phases.resolveMany([topic.round]);

    return withActiveGroup(
      topic,
      phases.get(topic.round.id) ?? topic.round.phase,
    );
  }

  private async requireTopic(id: number) {
    const topic = await this.prisma.topic.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        lecturerId: true,
        semesterId: true,
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
