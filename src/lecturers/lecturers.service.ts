import { Injectable, NotFoundException } from '@nestjs/common';
import type { Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LecturersService {
  constructor(private readonly prisma: PrismaService) {}

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
        id: true,
        fullName: true,
        academicTitle: true,
        bio: true,
        researchInterests: true,
        phone: true,
        user: { select: { email: true, avatarUrl: true, isActive: true } },
      },
    });

    if (!lecturer || !lecturer.user.isActive) {
      throw new NotFoundException('Không tìm thấy giảng viên');
    }

    const { user, phone, ...profile } = lecturer;
    const maySeeContact = await this.maySeeContact(lecturerProfileId, viewer);

    return {
      ...profile,
      avatarUrl: user.avatarUrl,
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
