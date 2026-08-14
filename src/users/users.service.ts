import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { Prisma } from '../../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpsertLecturerProfileDto } from './dto/upsert-lecturer-profile.dto';
import { UpsertStudentProfileDto } from './dto/upsert-student-profile.dto';
import {
  formatImportRowError,
  ImportRowSchema,
  toImportRowInput,
} from './import/import-row.schema';
import { parseImportFile } from './import/parse-import-file.util';

export interface BulkImportRowResult {
  row: number;
  email?: string;
  role?: 'STUDENT' | 'LECTURER';
  reason?: string;
}

export interface BulkImportResult {
  total: number;
  createdCount: number;
  failedCount: number;
  created: BulkImportRowResult[];
  failed: BulkImportRowResult[];
}

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

    const user = await this.createAccountWithProfile(dto, passwordHash).catch(
      (err) => {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          const codeLabel = dto.role === 'STUDENT' ? 'Student' : 'Lecturer';
          throw new ConflictException(`${codeLabel} code is already in use`);
        }
        throw err;
      },
    );

    await this.mailService.sendAccountCreated({
      to: user.email,
      fullName: dto.role === 'ADMIN' ? undefined : dto.fullName,
      tempPassword,
      role: user.role,
    });

    return user;
  }

  // ── bulkImport ───────────────────────────────────────────

  async bulkImport(file?: Express.Multer.File): Promise<BulkImportResult> {
    if (!file) throw new BadRequestException('No file uploaded');

    let rows: Awaited<ReturnType<typeof parseImportFile>>;
    try {
      rows = await parseImportFile(file.buffer, file.originalname);
    } catch (err) {
      throw new BadRequestException(
        `Could not read import file: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }

    if (rows.length === 0) {
      throw new BadRequestException('Import file has no data rows');
    }

    // Prefetch code -> id lookups once instead of querying per row
    const [majors, departments] = await Promise.all([
      this.prisma.major.findMany({ select: { id: true, code: true } }),
      this.prisma.department.findMany({ select: { id: true, code: true } }),
    ]);
    const majorIdByCode = new Map(majors.map((m) => [m.code, m.id]));
    const departmentIdByCode = new Map(departments.map((d) => [d.code, d.id]));

    const created: BulkImportRowResult[] = [];
    const failed: BulkImportRowResult[] = [];
    const emailsSeenInFile = new Set<string>();
    const pendingEmails: Parameters<MailService['sendAccountCreated']>[0][] =
      [];

    for (const raw of rows) {
      const input = toImportRowInput(raw.values);
      const parsed = ImportRowSchema.safeParse(input);

      if (!parsed.success) {
        failed.push({
          row: raw.rowNumber,
          email: raw.values.email,
          reason: formatImportRowError(parsed.error),
        });
        continue;
      }

      const data = parsed.data;

      if (emailsSeenInFile.has(data.email)) {
        failed.push({
          row: raw.rowNumber,
          email: data.email,
          reason: 'Duplicate email within the file',
        });
        continue;
      }
      emailsSeenInFile.add(data.email);

      const relationId =
        data.role === 'STUDENT'
          ? majorIdByCode.get(data.majorCode)
          : departmentIdByCode.get(data.departmentCode);

      if (relationId === undefined) {
        const codeLabel =
          data.role === 'STUDENT' ? 'majorCode' : 'departmentCode';
        const codeValue =
          data.role === 'STUDENT' ? data.majorCode : data.departmentCode;
        failed.push({
          row: raw.rowNumber,
          email: data.email,
          reason: `${codeLabel} "${codeValue}" not found`,
        });
        continue;
      }

      const existing = await this.prisma.user.findUnique({
        where: { email: data.email },
      });
      if (existing) {
        failed.push({
          row: raw.rowNumber,
          email: data.email,
          reason: 'Email already in use',
        });
        continue;
      }

      const tempPassword = this.generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, 10);

      try {
        await this.prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email: data.email,
              password: passwordHash,
              role: data.role,
              mustChangePassword: true,
            },
          });

          if (data.role === 'STUDENT') {
            await tx.studentProfile.create({
              data: {
                userId: user.id,
                studentCode: data.code,
                fullName: data.fullName,
                majorId: relationId,
                class: data.class,
                cohort: data.cohort,
                phone: data.phone,
                bio: data.bio,
              },
            });
          } else {
            await tx.lecturerProfile.create({
              data: {
                userId: user.id,
                lecturerCode: data.code,
                fullName: data.fullName,
                departmentId: relationId,
                academicTitle: data.academicTitle,
                phone: data.phone,
                bio: data.bio,
                researchInterests: data.researchInterests,
              },
            });
          }
        });
      } catch (err) {
        const codeField = data.role === 'STUDENT' ? 'Student' : 'Lecturer';
        failed.push({
          row: raw.rowNumber,
          email: data.email,
          reason:
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
              ? `${codeField} code "${data.code}" is already in use`
              : 'Unexpected error creating account',
        });
        continue;
      }

      created.push({ row: raw.rowNumber, email: data.email, role: data.role });
      pendingEmails.push({
        to: data.email,
        fullName: data.fullName,
        tempPassword,
        role: data.role,
      });
    }

    // Best-effort concurrent delivery — a failed send never fails the import,
    // MailService already swallows and logs its own errors.
    await Promise.allSettled(
      pendingEmails.map((payload) =>
        this.mailService.sendAccountCreated(payload),
      ),
    );

    return {
      total: rows.length,
      createdCount: created.length,
      failedCount: failed.length,
      created,
      failed,
    };
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

  async resetPassword(id: number) {
    const user = await this.findOne(id);

    // Same pattern as create(): admin never sets the password directly — a
    // fresh temp password is generated and delivered by email.
    const tempPassword = this.generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    await this.prisma.user.update({
      where: { id },
      data: { password: passwordHash, mustChangePassword: true },
    });

    // Revoke all refresh tokens so the user must re-login
    await this.prisma.refreshToken.deleteMany({ where: { userId: id } });

    await this.mailService.sendPasswordReset({
      to: user.email,
      fullName: user.studentProfile?.fullName ?? user.lecturerProfile?.fullName,
      tempPassword,
      role: user.role,
    });

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

  /**
   * Writes the account and its role profile together, so a failed profile
   * insert can never leave a bare, unusable User behind.
   */
  private createAccountWithProfile(dto: CreateUserDto, passwordHash: string) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email,
          password: passwordHash,
          role: dto.role,
          mustChangePassword: true,
        },
        select: USER_SELECT,
      });

      if (dto.role === 'STUDENT') {
        await tx.studentProfile.create({
          data: {
            userId: user.id,
            studentCode: dto.studentCode,
            fullName: dto.fullName,
            majorId: dto.majorId,
            class: dto.class,
            cohort: dto.cohort,
            phone: dto.phone,
            bio: dto.bio,
          },
        });
      } else if (dto.role === 'LECTURER') {
        await tx.lecturerProfile.create({
          data: {
            userId: user.id,
            lecturerCode: dto.lecturerCode,
            fullName: dto.fullName,
            departmentId: dto.departmentId,
            academicTitle: dto.academicTitle,
            researchInterests: dto.researchInterests,
            phone: dto.phone,
            bio: dto.bio,
          },
        });
      }

      return user;
    });
  }

  private generateTempPassword(): string {
    return Array.from(
      { length: TEMP_PASSWORD_LENGTH },
      () => TEMP_PASSWORD_CHARSET[randomInt(TEMP_PASSWORD_CHARSET.length)],
    ).join('');
  }
}
