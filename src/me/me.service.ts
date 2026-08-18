import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  LECTURER_ONLY_FIELDS,
  type UpdateMyProfileDto,
} from './dto/update-my-profile.dto';

/**
 * What the caller may see about themselves.
 *
 * Written out field by field rather than taken whole. `StudentProfile` carries
 * `note` — the faculty office's private remarks about the student, "bảo lưu
 * HK1", "gọi không nghe máy" — and a `select: true` on that table hands it
 * straight back to the person it is about. That is how it used to leave through
 * `/auth/me`.
 */
const STUDENT_FIELDS = {
  studentCode: true,
  fullName: true,
  class: true,
  cohort: true,
  phone: true,
  bio: true,
  major: { select: { id: true, name: true, code: true } },
} as const;

const LECTURER_FIELDS = {
  // The public page is keyed on this id, so a lecturer's own screen can offer
  // "xem hồ sơ công khai" without a second lookup.
  id: true,
  lecturerCode: true,
  fullName: true,
  academicTitle: true,
  phone: true,
  bio: true,
  researchInterests: true,
  maxMentoringQuota: true,
} as const;

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  /**
   * The account and its one role block.
   *
   * Identity lives at the top — name, address, role, picture — because it is the
   * same for all three roles and every screen that greets somebody wants exactly
   * that. What differs by role goes underneath, in the block for that role, and
   * the other block is null rather than absent so a client can tell "no lecturer
   * profile" from "field not sent".
   */
  async getProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        avatarUrl: true,
        mustChangePassword: true,
        createdAt: true,
        studentProfile: { select: STUDENT_FIELDS },
        lecturerProfile: { select: LECTURER_FIELDS },
      },
    });

    if (!user) throw new NotFoundException('Không tìm thấy tài khoản');

    const { studentProfile, lecturerProfile, ...account } = user;

    return {
      ...account,
      fullName: studentProfile?.fullName ?? lecturerProfile?.fullName ?? null,
      student: studentProfile,
      lecturer: lecturerProfile,
    };
  }

  /**
   * Whichever profile row belongs to this account, updated in place.
   *
   * An admin has neither row, so there is nothing here for them to edit — and
   * saying so is better than accepting the request and changing nothing.
   */
  async updateProfile(userId: number, dto: UpdateMyProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        studentProfile: { select: { id: true } },
        lecturerProfile: { select: { id: true } },
      },
    });

    if (!user) throw new NotFoundException('Không tìm thấy tài khoản');

    const { phone, bio, academicTitle, researchInterests } = dto;

    if (user.role === 'STUDENT' && user.studentProfile) {
      // Refused rather than ignored. A request that sets a field the sender is
      // not allowed to set has misunderstood something, and answering "saved"
      // to it teaches the misunderstanding.
      const forbidden = LECTURER_ONLY_FIELDS.filter(
        (field) => dto[field] !== undefined,
      );
      if (forbidden.length > 0) {
        throw new BadRequestException(
          `Hồ sơ sinh viên không có trường: ${forbidden.join(', ')}`,
        );
      }

      await this.prisma.studentProfile.update({
        where: { id: user.studentProfile.id },
        data: {
          ...(phone !== undefined && { phone }),
          ...(bio !== undefined && { bio }),
        },
      });

      return this.getProfile(userId);
    }

    if (user.role === 'LECTURER' && user.lecturerProfile) {
      await this.prisma.lecturerProfile.update({
        where: { id: user.lecturerProfile.id },
        data: {
          ...(phone !== undefined && { phone }),
          ...(bio !== undefined && { bio }),
          ...(academicTitle !== undefined && { academicTitle }),
          ...(researchInterests !== undefined && { researchInterests }),
        },
      });

      return this.getProfile(userId);
    }

    throw new BadRequestException(
      'Tài khoản này không có hồ sơ cá nhân để cập nhật',
    );
  }

  /**
   * Replace the caller's picture.
   *
   * The row is pointed at the new image before the old one is destroyed, so an
   * interruption anywhere in here leaves an avatar that works. The reverse order
   * would trade a leaked file for a broken image on every screen that shows it.
   */
  async setAvatar(userId: number, file: Express.Multer.File) {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarPublicId: true },
    });

    if (!current) throw new NotFoundException('Không tìm thấy tài khoản');

    const stored = await this.cloudinary.uploadAvatar(file);

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: stored.url, avatarPublicId: stored.publicId },
      select: { avatarUrl: true },
    });

    if (current.avatarPublicId) {
      await this.cloudinary.destroy(current.avatarPublicId);
    }

    return user;
  }

  /** Back to initials. Idempotent: removing an avatar nobody has is not an error. */
  async removeAvatar(userId: number) {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarPublicId: true },
    });

    if (!current) throw new NotFoundException('Không tìm thấy tài khoản');

    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null, avatarPublicId: null },
    });

    if (current.avatarPublicId) {
      await this.cloudinary.destroy(current.avatarPublicId);
    }

    return { avatarUrl: null };
  }
}
