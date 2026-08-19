import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryLecturersDto } from './dto/query-lecturers.dto';
import {
  MentoringLoadService,
  type MentoringLoad,
} from './mentoring-load.service';

/**
 * What a directory row has to carry: enough to choose between two people.
 *
 * `researchInterests` is long text in a list response, which usually should not
 * be there, and it earns its place — it is the only field that distinguishes one
 * name from the next when a student is deciding who to send an idea to. Contact
 * details are absent for the same reason they are absent from a topic: a list
 * every student can read is not where forty phone numbers belong.
 */
const DIRECTORY_SELECT = {
  id: true,
  fullName: true,
  academicTitle: true,
  researchInterests: true,
  maxMentoringQuota: true,
  user: { select: { avatarUrl: true } },
} satisfies Prisma.LecturerProfileSelect;

type DirectoryRow = Prisma.LecturerProfileGetPayload<{
  select: typeof DIRECTORY_SELECT;
}>;

@Injectable()
export class LecturersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mentoring: MentoringLoadService,
  ) {}

  /**
   * Every supervisor a student could put an idea to.
   *
   * This is a wider door than the rest of the app opens, so it is worth saying
   * what it does and does not let through. It lists names, titles, research
   * areas and how much each person is already supervising — nothing an account
   * holds privately, and nothing `/lecturers/:id` did not already answer one id
   * at a time. It lists no students, no accounts, and never an address or a
   * phone number.
   *
   * It exists because the proposal form has to offer a choice of supervisor, and
   * the only list that existed before was "lecturers who already have a topic",
   * which is precisely the wrong set: a student writes their own idea when the
   * catalogue does not have what they want, and the person who would guide it is
   * often the one who published nothing this term.
   */
  async findAll(query: QueryLecturersDto) {
    const where: Prisma.LecturerProfileWhereInput = {
      // A locked or departed account cannot answer a proposal, so offering it
      // as a choice only produces a wait that ends in nothing.
      user: { isActive: true },
      ...(query.q && {
        OR: [
          { fullName: { contains: query.q, mode: 'insensitive' } },
          { lecturerCode: { contains: query.q, mode: 'insensitive' } },
        ],
      }),
    };

    const [rows, total, semesterId] = await Promise.all([
      this.prisma.lecturerProfile.findMany({
        where,
        select: DIRECTORY_SELECT,
        orderBy: { fullName: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.lecturerProfile.count({ where }),
      this.mentoring.activeSemesterId(),
    ]);

    const load = await this.mentoring.loadFor(rows, semesterId);

    return {
      items: rows.map((row) => render(row, load(row))),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  /**
   * A supervisor, as the rest of the faculty may see them.
   *
   * Keyed on `LecturerProfile.id` because that is the id every other payload
   * already carries — a topic's `lecturer.id`, a group's `topic.lecturer.id` —
   * so a screen can link to this page from anything it has already loaded
   * without a second lookup.
   *
   * Contact details are the whole reason this needs a rule. The topic endpoints
   * deliberately withhold them: a list readable by every student is not the
   * place to publish forty people's phone numbers, and a student browsing
   * topics has no business ringing anyone yet. But a student the lecturer
   * actually supervises does, and telling them to find the number elsewhere is
   * the system refusing to do the one thing it exists for. So the address and
   * the phone are shown to staff, and to a student who is in a group on one of
   * this lecturer's topics — a fact the database can answer, rather than a
   * judgement the screen has to make.
   */
  async findOne(
    lecturerProfileId: number,
    viewer: { userId: number; role: Role },
  ) {
    const lecturer = await this.prisma.lecturerProfile.findUnique({
      where: { id: lecturerProfileId },
      select: {
        ...DIRECTORY_SELECT,
        bio: true,
        phone: true,
        user: { select: { email: true, avatarUrl: true, isActive: true } },
      },
    });

    if (!lecturer || !lecturer.user.isActive) {
      throw new NotFoundException('Không tìm thấy giảng viên');
    }

    const [maySeeContact, load] = await Promise.all([
      this.maySeeContact(lecturerProfileId, viewer),
      this.mentoring
        .activeSemesterId()
        .then((semesterId) => this.mentoring.loadForOne(lecturer, semesterId)),
    ]);

    const { phone, bio, user } = lecturer;

    return {
      ...render({ ...lecturer, user: { avatarUrl: user.avatarUrl } }, load),
      bio,
      email: maySeeContact ? user.email : null,
      phone: maySeeContact ? phone : null,
    };
  }

  private async maySeeContact(
    lecturerProfileId: number,
    viewer: { userId: number; role: Role },
  ): Promise<boolean> {
    if (viewer.role !== 'STUDENT') return true;

    const supervised = await this.prisma.registrationGroupMember.count({
      where: {
        student: { userId: viewer.userId },
        group: { topic: { lecturerId: lecturerProfileId } },
      },
    });

    return supervised > 0;
  }
}

/**
 * The avatar lives on the account; to a reader it is simply the person. The
 * quota goes out folded into the load rather than as a bare number, because on
 * its own "hạn mức 6" tells a student nothing, where "đang hướng dẫn 6/6" tells
 * them to ask somebody else.
 */
function render(lecturer: DirectoryRow, mentoring: MentoringLoad) {
  return {
    id: lecturer.id,
    fullName: lecturer.fullName,
    academicTitle: lecturer.academicTitle,
    researchInterests: lecturer.researchInterests,
    avatarUrl: lecturer.user.avatarUrl,
    mentoring,
  };
}
