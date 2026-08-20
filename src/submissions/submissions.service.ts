import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GroupMemberStatus,
  NotificationType,
  Prisma,
  RegistrationGroupStatus,
  Role,
  SubmissionType,
} from '../../generated/prisma/client';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateSubmissionDto,
  QuerySubmissionsDto,
  SubmissionFeedbackDto,
} from './dto/submission.dto';

/**
 * Everything either side of a submission needs to read.
 *
 * `filePublicId` is deliberately absent: it is the storage provider's handle,
 * used to delete the file, and it is no more a caller's business than a row id
 * in someone else's table. The URL is what a reader follows.
 */
const SUBMISSION_SELECT = {
  id: true,
  submissionType: true,
  version: true,
  fileUrl: true,
  fileName: true,
  fileSize: true,
  submissionUrl: true,
  lecturerFeedback: true,
  feedbackAt: true,
  submittedAt: true,
  submittedBy: {
    select: { id: true, fullName: true, studentCode: true },
  },
  group: {
    select: {
      id: true,
      name: true,
      topic: {
        select: {
          id: true,
          title: true,
          lecturer: {
            select: { id: true, fullName: true, academicTitle: true },
          },
          // Carried only so `present` can say whether this arrived in time. The
          // round is where report deadlines live, and it never reaches a
          // response as itself.
          round: { select: { midtermDueAt: true, finalDueAt: true } },
        },
      },
    },
  },
} satisfies Prisma.SubmissionSelect;

type SubmissionRow = Prisma.SubmissionGetPayload<{
  select: typeof SUBMISSION_SELECT;
}>;

/**
 * One submission as a caller reads it, with the deadline it was measured
 * against.
 *
 * Lateness is worked out here rather than stored on the row, and that is
 * deliberate: an office that pushes a deadline back means the work is no longer
 * late, and a stamped flag would go on saying it was. The trade is that a
 * deadline moved *forward* retroactively makes old work late — which is the
 * same thing the office would be announcing anyway.
 *
 * Source code is measured against the final report's deadline. It is handed in
 * with the report, and a fourth date would be a fourth thing to keep in step.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a deadline actually expires: the end of the day the office named, not
 * its first instant.
 *
 * The office picks a calendar day, which the client sends as midnight UTC of
 * that day. Comparing against that value directly would mark a group late at
 * seven in the morning on the very day their report is due — an announcement
 * saying "hạn 22/08" that stops accepting work during breakfast on the 22nd is
 * the system disagreeing with its own notice.
 */
function expiryOf(dueAt: Date): number {
  return dueAt.getTime() + DAY_MS;
}

function present(submission: SubmissionRow) {
  const { round, ...topic } = submission.group.topic;
  const dueAt =
    submission.submissionType === SubmissionType.MIDTERM
      ? round.midtermDueAt
      : round.finalDueAt;

  return {
    ...submission,
    group: { ...submission.group, topic },
    /** Null when the office has announced no deadline for this kind of report. */
    dueAt,
    isLate:
      dueAt !== null && submission.submittedAt.getTime() >= expiryOf(dueAt),
  };
}

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: CloudinaryService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Hand something in.
   *
   * A group submits and a person presses the button, so the row records both:
   * the group is what the work belongs to, and `submittedById` is who sent this
   * particular version — the first question asked when two members disagree
   * about what was handed in.
   *
   * Nothing is ever overwritten. A re-submission is a new row one version higher,
   * because the previous one may already have been read and answered, and a
   * supervisor's feedback pointing at a file that has since been replaced is
   * feedback about something nobody can see any more.
   */
  async create(
    dto: CreateSubmissionDto,
    file: Express.Multer.File | undefined,
    userId: number,
  ) {
    const student = await this.requireStudent(userId);
    const group = await this.requireOwnGroup(student.id);

    if (!file && !dto.submissionUrl) {
      throw new BadRequestException(
        'Cần tải lên một file hoặc dán một link — nộp trống thì không có gì để chấm.',
      );
    }

    // Uploaded before the row is written and outside any transaction, because
    // it is a network call to somebody else's service: holding a database
    // transaction open across it would be holding a lock for as long as a
    // student's upstream takes.
    const stored = file ? await this.storage.uploadDocument(file) : null;

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // Read inside the transaction: two members pressing submit together
        // would otherwise both see the same highest version and both claim it.
        const latest = await tx.submission.findFirst({
          where: {
            groupId: group.id,
            submissionType: dto.submissionType,
          },
          select: { version: true },
          orderBy: { version: 'desc' },
        });

        return tx.submission.create({
          data: {
            groupId: group.id,
            topicId: group.topicId,
            submissionType: dto.submissionType,
            version: (latest?.version ?? 0) + 1,
            submittedById: student.id,
            ...(stored && {
              fileUrl: stored.url,
              filePublicId: stored.publicId,
              fileName: stored.fileName,
              fileSize: stored.bytes,
            }),
            ...(dto.submissionUrl && { submissionUrl: dto.submissionUrl }),
          },
          select: SUBMISSION_SELECT,
        });
      });

      return present(created);
    } catch (error) {
      // The file is already in the provider's account and now nothing points at
      // it, so it is taken back out rather than left to sit there forever.
      if (stored) await this.storage.destroy(stored.publicId, 'raw');
      throw error;
    }
  }

  /**
   * One list, read from whichever end the caller stands at.
   *
   * A student sees their own group's work and cannot ask for anybody else's — no
   * filter here reaches past their own group, because the where clause is built
   * from their token before any query parameter is applied.
   */
  async findAll(query: QuerySubmissionsDto, userId: number, role: Role) {
    const where: Prisma.SubmissionWhereInput = {
      ...(query.submissionType && { submissionType: query.submissionType }),
    };

    if (role === Role.STUDENT) {
      const student = await this.requireStudent(userId);
      const group = await this.findOwnGroup(student.id);

      // No group, no submissions — and answering with an empty page is the
      // truthful version of that rather than an error.
      if (!group) return empty(query);

      where.groupId = group.id;
    } else if (role === Role.LECTURER) {
      const lecturer = await this.requireLecturer(userId);
      where.topic = { lecturerId: lecturer.id };

      // Staff filters apply within what they are already allowed to see, never
      // instead of it.
      if (query.groupId) where.groupId = query.groupId;
      if (query.topicId) where.topicId = query.topicId;
    } else {
      if (query.groupId) where.groupId = query.groupId;
      if (query.topicId) where.topicId = query.topicId;
    }

    const [items, total] = await Promise.all([
      this.prisma.submission.findMany({
        where,
        select: SUBMISSION_SELECT,
        // Newest first, and within one moment the higher version first: a
        // supervisor opening this wants the latest of each kind at the top.
        orderBy: [{ submittedAt: 'desc' }, { version: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.submission.count({ where }),
    ]);

    return {
      items: items.map(present),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  /**
   * The supervisor's answer to one version.
   *
   * Written against the version it was about rather than against the group, so
   * a student who re-submits does not silently inherit feedback on the file they
   * replaced.
   */
  async giveFeedback(id: number, dto: SubmissionFeedbackDto, userId: number) {
    const lecturer = await this.requireLecturer(userId);
    const submission = await this.prisma.submission.findFirst({
      where: { id, topic: { lecturerId: lecturer.id } },
      select: {
        id: true,
        submissionType: true,
        version: true,
        group: {
          select: {
            id: true,
            topic: { select: { title: true } },
            members: {
              where: { status: GroupMemberStatus.ACCEPTED },
              select: { student: { select: { userId: true } } },
            },
          },
        },
      },
    });

    // 404 rather than 403 for a submission on somebody else's topic: knowing an
    // id should not confirm that it exists.
    if (!submission) throw new NotFoundException('Không tìm thấy bài nộp');

    const updated = await this.prisma.submission.update({
      where: { id },
      data: { lecturerFeedback: dto.feedback, feedbackAt: new Date() },
      select: SUBMISSION_SELECT,
    });

    await this.notifications.notify(
      submission.group.members.map((member) => ({
        userId: member.student.userId,
        type: NotificationType.SUBMISSION_FEEDBACK,
        title: 'Giảng viên đã nhận xét bài nộp',
        content: `${lecturerName(lecturer)} vừa nhận xét ${LABEL[submission.submissionType]} (lần ${submission.version}) của đề tài "${submission.group.topic.title}".`,
        targetId: submission.group.id,
      })),
    );

    return updated;
  }

  // ── guards ────────────────────────────────────────────────

  private async requireStudent(userId: number) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { id: true, fullName: true },
    });

    if (!student) {
      throw new ForbiddenException('Tài khoản này không có hồ sơ sinh viên');
    }

    return student;
  }

  private async requireLecturer(userId: number) {
    const lecturer = await this.prisma.lecturerProfile.findUnique({
      where: { userId },
      select: { id: true, fullName: true, academicTitle: true },
    });

    if (!lecturer) {
      throw new ForbiddenException('Tài khoản này không có hồ sơ giảng viên');
    }

    return lecturer;
  }

  /**
   * The group this student is working in, across every term they have one in.
   *
   * Not narrowed to the active semester on purpose: a report belongs to the
   * topic it was written for, and a student reading last term's feedback after
   * the office has opened the next term should still find it.
   */
  private async findOwnGroup(studentId: number) {
    const membership = await this.prisma.registrationGroupMember.findFirst({
      where: {
        studentId,
        status: GroupMemberStatus.ACCEPTED,
        group: { status: { not: RegistrationGroupStatus.REJECTED } },
      },
      select: { group: { select: { id: true, topicId: true } } },
      orderBy: { id: 'desc' },
    });

    return membership?.group ?? null;
  }

  private async requireOwnGroup(studentId: number) {
    const group = await this.findOwnGroup(studentId);

    if (!group) {
      throw new ForbiddenException(
        'Bạn chưa có nhóm đề tài nào, nên chưa nộp bài được.',
      );
    }

    return group;
  }
}

/** What each kind of submission is called, for a sentence in a notice. */
const LABEL: Record<string, string> = {
  MIDTERM: 'báo cáo giữa kỳ',
  FINAL: 'báo cáo cuối kỳ',
  SOURCE_CODE: 'mã nguồn',
};

function lecturerName(lecturer: {
  fullName: string;
  academicTitle: string | null;
}) {
  return lecturer.academicTitle
    ? `${lecturer.academicTitle} ${lecturer.fullName}`
    : lecturer.fullName;
}

function empty(query: { page: number; limit: number }) {
  return {
    items: [],
    total: 0,
    page: query.page,
    limit: query.limit,
    totalPages: 0,
  };
}
