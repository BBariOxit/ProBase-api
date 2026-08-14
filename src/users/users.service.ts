import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpsertLecturerProfileDto } from './dto/upsert-lecturer-profile.dto';
import { UpsertStudentProfileDto } from './dto/upsert-student-profile.dto';

// Safe user select — never expose password hash
const USER_SELECT = {
  id: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Excludes visually ambiguous characters (0/O, 1/l/I)
const TEMP_PASSWORD_CHARSET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const TEMP_PASSWORD_LENGTH = 12;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  // ── findAll ──────────────────────────────────────────────

  async findAll(query: QueryUsersDto) {
    const { role, isActive, search, page, limit } = query;

    const where = {
      ...(role !== undefined && { role }),
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { email: { contains: search, mode: 'insensitive' as const } },
          {
            studentProfile: {
              fullName: { contains: search, mode: 'insensitive' as const },
            },
          },
          {
            lecturerProfile: {
              fullName: { contains: search, mode: 'insensitive' as const },
            },
          },
        ],
      }),
    };

    const skip = (page - 1) * limit;

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          ...USER_SELECT,
          studentProfile: {
            select: {
              id: true,
              studentCode: true,
              fullName: true,
              class: true,
              cohort: true,
            },
          },
          lecturerProfile: {
            select: {
              id: true,
              lecturerCode: true,
              fullName: true,
              academicTitle: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ── findOne ───────────────────────────────────────────────

  async findOne(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...USER_SELECT,
        studentProfile: true,
        lecturerProfile: true,
      },
    });

    if (!user) throw new NotFoundException(`User #${id} not found`);

    return user;
  }

  // ── create ────────────────────────────────────────────────

  async create(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already in use');

    // Admin never sets the password directly — a temp password is generated
    // and delivered by email; the user must change it on first login.
    const tempPassword = this.generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: passwordHash,
        role: dto.role,
        mustChangePassword: true,
      },
      select: USER_SELECT,
    });

    await this.mailService.sendAccountCreated({
      to: user.email,
      tempPassword,
      role: user.role,
    });

    return user;
  }

  // ── update ────────────────────────────────────────────────

  async update(id: number, dto: UpdateUserDto) {
    await this.findOne(id);

    if (dto.email) {
      const conflict = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (conflict && conflict.id !== id) {
        throw new ConflictException('Email already in use');
      }
    }

    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: USER_SELECT,
    });
  }

  // ── remove ────────────────────────────────────────────────

  async remove(id: number) {
    await this.findOne(id);

    await this.prisma.user.delete({ where: { id } });

    return { message: `User #${id} deleted successfully` };
  }

  // ── resetPassword ─────────────────────────────────────────

  async resetPassword(id: number, dto: ResetPasswordDto) {
    await this.findOne(id);

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.user.update({
      where: { id },
      data: { password: passwordHash },
    });

    // Revoke all refresh tokens so the user must re-login
    await this.prisma.refreshToken.deleteMany({ where: { userId: id } });

    return { message: 'Password reset successfully' };
  }

  // ── upsertStudentProfile ──────────────────────────────────

  async upsertStudentProfile(id: number, dto: UpsertStudentProfileDto) {
    const user = await this.findOne(id);

    // Prevent assigning a student profile to a non-student account
    if (user.role !== 'STUDENT') {
      throw new ConflictException(
        'Student profile can only be assigned to a STUDENT account',
      );
    }

    // Check studentCode uniqueness (excluding current user's profile)
    const codeConflict = await this.prisma.studentProfile.findUnique({
      where: { studentCode: dto.studentCode },
    });
    if (codeConflict && codeConflict.userId !== id) {
      throw new ConflictException(
        `Student code "${dto.studentCode}" is already in use`,
      );
    }

    return this.prisma.studentProfile.upsert({
      where: { userId: id },
      create: { userId: id, ...dto },
      update: dto,
    });
  }

  // ── upsertLecturerProfile ─────────────────────────────────

  async upsertLecturerProfile(id: number, dto: UpsertLecturerProfileDto) {
    const user = await this.findOne(id);

    if (user.role !== 'LECTURER') {
      throw new ConflictException(
        'Lecturer profile can only be assigned to a LECTURER account',
      );
    }

    // Check lecturerCode uniqueness (excluding current user's profile)
    const codeConflict = await this.prisma.lecturerProfile.findUnique({
      where: { lecturerCode: dto.lecturerCode },
    });
    if (codeConflict && codeConflict.userId !== id) {
      throw new ConflictException(
        `Lecturer code "${dto.lecturerCode}" is already in use`,
      );
    }

    return this.prisma.lecturerProfile.upsert({
      where: { userId: id },
      create: { userId: id, ...dto },
      update: dto,
    });
  }

  // ── Private helpers ──────────────────────────────────────

  private generateTempPassword(): string {
    return Array.from(
      { length: TEMP_PASSWORD_LENGTH },
      () => TEMP_PASSWORD_CHARSET[randomInt(TEMP_PASSWORD_CHARSET.length)],
    ).join('');
  }
}
