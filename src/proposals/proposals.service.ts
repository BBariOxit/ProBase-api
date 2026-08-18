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
  TopicProposalStatus,
  TopicStatus,
} from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RoundPhaseService } from '../rounds/round-phase.service';
import { RoundsService } from '../rounds/rounds.service';
import { CreateProposalDto } from './dto/create-proposal.dto';
import {
  AcceptProposalDto,
  RejectProposalDto,
} from './dto/answer-proposal.dto';
import { QueryProposalsDto } from './dto/query-proposals.dto';
import { UpdateProposalDto } from './dto/update-proposal.dto';

/**
 * Everything either side needs to read a proposal, and nothing either side does
 * not.
 *
 * The student block is here because the lecturer's inbox is a queue of people as
 * much as of ideas — a name, a code and a class are what tell them whether this
 * is a final-year student they have taught. The address is not: a proposal is
 * answered in the system, and a lecturer who wants to talk has the student's own
 * profile page a click away.
 */
const PROPOSAL_SELECT = {
  id: true,
  status: true,
  title: true,
  description: true,
  expectedOutcomes: true,
  lecturerFeedback: true,
  createdAt: true,
  updatedAt: true,
  semester: { select: { id: true, name: true, code: true } },
  projectType: { select: { id: true, name: true, code: true } },
  student: {
    select: {
      id: true,
      fullName: true,
      studentCode: true,
      class: true,
      user: { select: { avatarUrl: true } },
    },
  },
  requestedLecturer: {
    select: { id: true, fullName: true, academicTitle: true },
  },
  acceptedByLecturer: {
    select: { id: true, fullName: true, academicTitle: true },
  },
  // What the yes turned into. Its status matters as much as its id: a topic
  // accepted by a lecturer still waits on the faculty office, and a student
  // staring at a register button that is not there deserves to know which of the
  // two is holding it up.
  convertedTopic: { select: { id: true, title: true, status: true } },
} satisfies Prisma.TopicProposalSelect;

type ProposalRow = Prisma.TopicProposalGetPayload<{
  select: typeof PROPOSAL_SELECT;
}>;

@Injectable()
export class ProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rounds: RoundsService,
    private readonly phases: RoundPhaseService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Put an idea to a lecturer.
   *
   * The four refusals in here are the whole policy, in the order a person would
   * hit them: the faculty has to have opened this kind of project to your
   * intake, the round has to be at a stage where a proposal can still become
   * something, you cannot ask for a topic while already holding one, and you get
   * one open proposal at a time.
   *
   * That last one is not tidiness. Without it the cheapest strategy is to send
   * the same idea to six lecturers and take whoever answers first, which costs
   * five of them a reading and leaves five topics half-created.
   */
  async create(dto: CreateProposalDto, userId: number) {
    const student = await this.requireStudent(userId);
    const semester = await this.requireActiveSemester();
    const round = await this.rounds.requireRoundFor(
      semester.id,
      dto.projectTypeId,
    );

    const eligible = await this.rounds.eligibleRoundIds(userId, [semester.id]);
    if (!eligible.includes(round.id)) {
      throw new ForbiddenException(
        'Khoá của bạn không mở loại đồ án này trong học kỳ hiện tại',
      );
    }

    await this.phases.requireCanPropose(round.id, student.id);
    await this.requireNoGroup(student.id, semester.id);
    await this.requireNoPendingProposal(student.id);

    const lecturer = await this.requireLecturer(dto.requestedLecturerId);

    const proposal = await this.prisma.topicProposal.create({
      data: {
        semesterId: semester.id,
        studentId: student.id,
        projectTypeId: dto.projectTypeId,
        requestedLecturerId: lecturer.id,
        title: dto.title,
        description: dto.description,
        expectedOutcomes: dto.expectedOutcomes,
      },
      select: PROPOSAL_SELECT,
    });

    await this.notifications.notify([
      {
        userId: lecturer.userId,
        type: 'PROPOSAL_SUBMITTED',
        title: 'Có đề xuất đề tài mới',
        content: `${student.fullName} đề xuất đề tài "${proposal.title}" và đang chờ bạn trả lời.`,
        targetId: proposal.id,
      },
    ]);

    return render(proposal);
  }

  /**
   * One list, read from whichever end the caller stands at.
   *
   * A student sees what they sent, a lecturer sees what was sent to them, and
   * the office sees everything. There is no parameter for whose proposals to
   * fetch, so there is nothing to tamper with.
   */
  async findAll(query: QueryProposalsDto, userId: number, role: Role) {
    const where: Prisma.TopicProposalWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.semesterId && { semesterId: query.semesterId }),
    };

    if (role === Role.STUDENT) {
      where.studentId = (await this.requireStudent(userId)).id;
    } else if (role === Role.LECTURER) {
      where.requestedLecturerId = (
        await this.requireOwnLecturerProfile(userId)
      ).id;
    }

    const [items, total] = await Promise.all([
      this.prisma.topicProposal.findMany({
        where,
        select: PROPOSAL_SELECT,
        // Pending first, then newest: a lecturer opens this screen to answer
        // what is waiting, not to browse what they answered last month.
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.topicProposal.count({ where }),
    ]);

    return {
      items: items.map(render),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async findOne(id: number, userId: number, role: Role) {
    const proposal = await this.requireProposal(id);

    if (!(await this.canView(proposal.id, userId, role))) {
      throw new NotFoundException('Không tìm thấy đề xuất');
    }

    return render(proposal);
  }

  /** The student's own words, while nobody has answered them yet. */
  async update(id: number, dto: UpdateProposalDto, userId: number) {
    const student = await this.requireStudent(userId);
    const proposal = await this.requireProposal(id);

    await this.requireOwnPending(id, student.id, proposal.status);

    const updated = await this.prisma.topicProposal.update({
      where: { id },
      data: dto,
      select: PROPOSAL_SELECT,
    });

    return render(updated);
  }

  /**
   * Withdraw. Deleted rather than marked, because an unanswered proposal that
   * the student took back is not a record of anything — nobody read it, nobody
   * decided anything, and keeping it would only pad a lecturer's history with
   * things that never happened to them.
   *
   * The notice that told the lecturer about it goes too. Otherwise their inbox
   * keeps a line pointing at a proposal that no longer exists, and following it
   * lands on a 404 — an inbox that sends you somewhere empty is worse than one
   * that never mentioned it.
   */
  async remove(id: number, userId: number) {
    const student = await this.requireStudent(userId);
    const proposal = await this.requireProposal(id);

    await this.requireOwnPending(id, student.id, proposal.status);

    await this.prisma.$transaction([
      this.prisma.notification.deleteMany({
        where: { type: 'PROPOSAL_SUBMITTED', targetId: id },
      }),
      this.prisma.topicProposal.delete({ where: { id } }),
    ]);

    return { message: 'Đã rút lại đề xuất' };
  }

  /**
   * Yes — and the topic that comes of it.
   *
   * Created as PENDING, exactly like a topic the lecturer wrote themselves, so
   * the faculty office still signs it off. Skipping that here would open a way
   * around the office's review: a lecturer who wanted an unreviewed topic would
   * only have to have a student propose it.
   *
   * The proposal and the topic are written together, because a proposal marked
   * accepted with no topic behind it is a promise the rest of the system cannot
   * keep.
   */
  async accept(id: number, dto: AcceptProposalDto, userId: number) {
    const lecturer = await this.requireOwnLecturerProfile(userId);
    const proposal = await this.requireAnswerable(id, lecturer.id);

    const round = await this.rounds.requireRoundFor(
      proposal.semesterId,
      proposal.projectTypeId,
    );
    await this.phases.requireCanAcceptProposal(round.id);

    const topic = await this.prisma.$transaction(async (tx) => {
      const created = await tx.topic.create({
        data: {
          semesterId: proposal.semesterId,
          roundId: round.id,
          lecturerId: lecturer.id,
          sourceProposalId: proposal.id,
          title: proposal.title,
          description: proposal.description,
          expectedOutcomes: proposal.expectedOutcomes,
          maxStudents: dto.maxStudents,
          status: TopicStatus.PENDING,
        },
        select: { id: true, title: true },
      });

      await tx.topicProposal.update({
        where: { id, status: TopicProposalStatus.PENDING },
        data: {
          status: TopicProposalStatus.ACCEPTED,
          acceptedByLecturerId: lecturer.id,
        },
      });

      return created;
    });

    await this.notifications.notify([
      {
        userId: proposal.student.userId,
        type: 'PROPOSAL_ACCEPTED',
        title: 'Đề xuất của bạn đã được nhận',
        content: `${lecturerName(lecturer)} nhận hướng dẫn đề tài "${topic.title}". Đề tài đang chờ khoa phê duyệt, sau đó bạn đăng ký để giữ chỗ.`,
        targetId: topic.id,
      },
    ]);

    return this.findOne(id, userId, Role.LECTURER);
  }

  /**
   * No, with a reason — the reason is required by the DTO and this is why: a
   * refusal a student cannot learn from produces the same proposal again, and
   * the lecturer reads it twice.
   */
  async reject(id: number, dto: RejectProposalDto, userId: number) {
    const lecturer = await this.requireOwnLecturerProfile(userId);
    const proposal = await this.requireAnswerable(id, lecturer.id);

    const updated = await this.prisma.topicProposal.update({
      where: { id, status: TopicProposalStatus.PENDING },
      data: {
        status: TopicProposalStatus.REJECTED,
        acceptedByLecturerId: null,
        lecturerFeedback: dto.feedback,
      },
      select: PROPOSAL_SELECT,
    });

    await this.notifications.notify([
      {
        userId: proposal.student.userId,
        type: 'PROPOSAL_REJECTED',
        title: 'Đề xuất chưa được nhận',
        content: `${lecturerName(lecturer)} chưa nhận đề tài "${proposal.title}". Mở đề xuất để đọc nhận xét.`,
        targetId: proposal.id,
      },
    ]);

    return render(updated);
  }

  // ── guards ────────────────────────────────────────────────

  private async requireStudent(userId: number) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { id: true, fullName: true, cohort: true },
    });

    if (!student) {
      throw new ForbiddenException('Tài khoản này không có hồ sơ sinh viên');
    }

    return student;
  }

  private async requireOwnLecturerProfile(userId: number) {
    const lecturer = await this.prisma.lecturerProfile.findUnique({
      where: { userId },
      select: { id: true, fullName: true, academicTitle: true },
    });

    if (!lecturer) {
      throw new ForbiddenException('Tài khoản này không có hồ sơ giảng viên');
    }

    return lecturer;
  }

  /** The lecturer a proposal is being addressed to, by profile id. */
  private async requireLecturer(lecturerProfileId: number) {
    const lecturer = await this.prisma.lecturerProfile.findUnique({
      where: { id: lecturerProfileId },
      select: { id: true, userId: true, user: { select: { isActive: true } } },
    });

    if (!lecturer || !lecturer.user.isActive) {
      throw new NotFoundException('Không tìm thấy giảng viên này');
    }

    return lecturer;
  }

  private async requireActiveSemester() {
    const semester = await this.prisma.semester.findFirst({
      where: { isActive: true },
      select: { id: true },
    });

    if (!semester) {
      throw new ConflictException('Chưa có học kỳ nào đang mở');
    }

    return semester;
  }

  private async requireProposal(id: number) {
    const proposal = await this.prisma.topicProposal.findUnique({
      where: { id },
      select: {
        ...PROPOSAL_SELECT,
        semesterId: true,
        projectTypeId: true,
        studentId: true,
        requestedLecturerId: true,
        student: {
          select: {
            id: true,
            fullName: true,
            studentCode: true,
            class: true,
            userId: true,
            user: { select: { avatarUrl: true } },
          },
        },
      },
    });

    if (!proposal) throw new NotFoundException('Không tìm thấy đề xuất');

    return proposal;
  }

  private async canView(id: number, userId: number, role: Role) {
    if (role === Role.ADMIN) return true;

    const proposal = await this.prisma.topicProposal.findFirst({
      where: {
        id,
        ...(role === Role.STUDENT
          ? { student: { userId } }
          : { requestedLecturer: { userId } }),
      },
      select: { id: true },
    });

    return proposal !== null;
  }

  /** Still the student's to change: theirs, and nobody has answered it. */
  private async requireOwnPending(
    id: number,
    studentId: number,
    status: TopicProposalStatus,
  ) {
    const owned = await this.prisma.topicProposal.findFirst({
      where: { id, studentId },
      select: { id: true },
    });

    if (!owned) throw new NotFoundException('Không tìm thấy đề xuất');

    if (status !== TopicProposalStatus.PENDING) {
      throw new ConflictException(
        'Đề xuất đã được trả lời nên không sửa hay rút lại được nữa. Bạn có thể gửi một đề xuất mới.',
      );
    }
  }

  /** Pending, and addressed to the lecturer trying to answer it. */
  private async requireAnswerable(id: number, lecturerProfileId: number) {
    const proposal = await this.requireProposal(id);

    if (proposal.requestedLecturerId !== lecturerProfileId) {
      throw new NotFoundException('Không tìm thấy đề xuất');
    }

    if (proposal.status !== TopicProposalStatus.PENDING) {
      throw new ConflictException('Đề xuất này đã được trả lời rồi');
    }

    return proposal;
  }

  private async requireNoGroup(studentId: number, semesterId: number) {
    const membership = await this.prisma.registrationGroupMember.findFirst({
      where: {
        studentId,
        semesterId,
        status: GroupMemberStatus.ACCEPTED,
        group: { status: { not: RegistrationGroupStatus.REJECTED } },
      },
      select: { id: true },
    });

    if (membership) {
      throw new ConflictException(
        'Bạn đã có đề tài trong học kỳ này. Rời nhóm trước nếu muốn đề xuất đề tài khác.',
      );
    }
  }

  private async requireNoPendingProposal(studentId: number) {
    const pending = await this.prisma.topicProposal.findFirst({
      where: { studentId, status: TopicProposalStatus.PENDING },
      select: { id: true },
    });

    if (pending) {
      throw new ConflictException(
        'Bạn đang có một đề xuất chờ trả lời. Rút lại đề xuất đó trước khi gửi cái mới.',
      );
    }
  }
}

/** The avatar is stored on the account; to a reader it is simply the person. */
function render(proposal: ProposalRow) {
  const { student, ...rest } = proposal;
  const { user, ...studentRest } = student;

  return { ...rest, student: { ...studentRest, avatarUrl: user.avatarUrl } };
}

function lecturerName(lecturer: {
  fullName: string;
  academicTitle: string | null;
}) {
  return lecturer.academicTitle
    ? `${lecturer.academicTitle} ${lecturer.fullName}`
    : lecturer.fullName;
}
