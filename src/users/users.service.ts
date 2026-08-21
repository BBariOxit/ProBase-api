import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { MailService } from '../mail/mail.service';
import { Role } from '../../generated/prisma/client';
import { recordAudit } from '../audit/audit-entry';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpsertLecturerProfileDto } from './dto/upsert-lecturer-profile.dto';
import { UpsertStudentProfileDto } from './dto/upsert-student-profile.dto';
import { mapWithConcurrency } from '../common/concurrency.util';
import {
  isUniqueViolation,
  uniqueConstraintFields,
} from '../common/prisma-error.util';
import { checkClassCode } from './class-code.util';
import {
  formatImportRowError,
  ImportRowSchema,
  toImportRowInput,
} from './import/import-row.schema';
import type { ImportRow } from './import/import-row.schema';
import { parseImportFile } from './import/parse-import-file.util';
import type { ParsedImportRow } from './import/parse-import-file.util';

/** A row that passed validation and resolved its major, if it needed one. */
interface ValidatedImportRow {
  rowNumber: number;
  data: ImportRow;
  /** Resolved from majorCode on STUDENT rows; absent on LECTURER rows, which
   *  have no master-data relation to resolve. */
  majorId?: number;
  /** Things worth telling the admin about a row that was still accepted. */
  warnings?: string[];
}

/** A validated row that also has its generated credentials ready to insert. */
interface PreparedImportRow extends ValidatedImportRow {
  tempPassword: string;
  passwordHash: string;
}

export interface BulkImportRowResult {
  row: number;
  email?: string;
  role?: 'STUDENT' | 'LECTURER';
  reason?: string;
  /** Created rows only: whether the credentials email actually went out. */
  emailSent?: boolean;
  /** Accepted, but with something the admin should look at — an unrecognised
   *  class code, for instance. Absent when there was nothing to say. */
  warnings?: string[];
}

export interface BulkImportResult {
  total: number;
  createdCount: number;
  failedCount: number;
  /**
   * Accounts that exist but whose credentials never reached anyone. The temp
   * password is not recoverable, so each of these needs an admin
   * reset-password before that user can log in — hence a top-level count
   * rather than something the admin has to spot by scanning rows.
   */
  emailsFailedCount: number;
  /**
   * Rows that imported with a caveat. Surfaced as a count so the admin knows to
   * look without having to scan every accepted row for a `warnings` key.
   */
  warnedCount: number;
  created: BulkImportRowResult[];
  failed: BulkImportRowResult[];
}

// Safe user select — never expose password hash.
// Used for list responses where avatar and session flags are irrelevant.
const USER_SELECT = {
  id: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Extended select for single-record responses (GET /users/:id).
// Includes `avatarUrl` so the profile dialog can show the picture, and
// `mustChangePassword` so it can surface a first-login warning — two fields
// that carry no value serialised across hundreds of list rows.
const USER_DETAIL_SELECT = {
  ...USER_SELECT,
  avatarUrl: true,
  mustChangePassword: true,
} as const;

/**
 * P2002 reports that a unique constraint tripped, not which one. Knowing which
 * matters because the email pre-check and the insert are not atomic — a
 * concurrent request can take the address in between — and blaming that on a
 * duplicate student code sends the admin auditing the wrong column.
 *
 * Returns null when the error is not a unique-constraint violation at all, and
 * an empty array when the driver gave us nothing to work with.
 */
function conflictingUniqueFields(err: unknown): string[] | null {
  if (!isUniqueViolation(err)) return null;

  return uniqueConstraintFields(err);
}

// Excludes visually ambiguous characters (0/O, 1/l/I)
const TEMP_PASSWORD_CHARSET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const TEMP_PASSWORD_LENGTH = 12;

// bcrypt's async hash runs on the libuv thread pool, which defaults to four
// threads — queueing more than that buys nothing.
const PASSWORD_HASH_CONCURRENCY = 4;
// Comfortably under Prisma's default connection pool, so a large import cannot
// starve the requests running alongside it.
const ACCOUNT_INSERT_CONCURRENCY = 5;
// Firing a whole roster at the mail provider at once is a good way to get
// rate-limited, which shows up as accounts nobody can log into.
const MAIL_SEND_CONCURRENCY = 5;

const byRowNumber = (a: BulkImportRowResult, b: BulkImportRowResult) =>
  a.row - b.row;

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
        ...USER_DETAIL_SELECT,
        studentProfile: true,
        lecturerProfile: true,
      },
    });

    if (!user) throw new NotFoundException(`User #${id} not found`);

    return user;
  }

  // ── create ────────────────────────────────────────────────

  async create(dto: CreateUserDto, actorId: number) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already in use');

    // Admin never sets the password directly — a temp password is generated
    // and delivered by email; the user must change it on first login.
    const tempPassword = this.generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const user = await this.createAccountWithProfile(dto, passwordHash).catch(
      (err: unknown) => {
        const conflict = conflictingUniqueFields(err);
        if (!conflict) throw err;

        if (conflict.some((field) => field.includes('email'))) {
          throw new ConflictException('Email already in use');
        }
        const codeLabel = dto.role === 'STUDENT' ? 'Student' : 'Lecturer';
        throw new ConflictException(`${codeLabel} code is already in use`);
      },
    );

    // Recorded after the account exists rather than inside its transaction:
    // createAccountWithProfile owns that one, and an account that was created is
    // a fact whether or not the line describing it lands. The reverse — a line
    // claiming an account that does not exist — is the direction worth avoiding.
    await this.prisma.$transaction((tx) =>
      recordAudit(tx, {
        userId: actorId,
        action: 'CREATE_USER',
        targetTable: 'users',
        targetId: user.id,
        newValue: { email: user.email, role: user.role },
      }),
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

    const failed: BulkImportRowResult[] = [];

    // Validate everything in memory first — a file that is entirely malformed
    // then costs nothing beyond parsing it.
    const validated = await this.validateImportRows(rows);
    failed.push(...validated.failed);

    // One query covering every address in the file, instead of one findUnique
    // per row — the same prefetch shape already used for majors.
    const usable = await this.rejectTakenEmails(validated.valid);
    failed.push(...usable.failed);

    // Hashing dominates the cost of an import (~100ms of CPU per row at cost
    // 10), so rows hash in parallel rather than each waiting on the last.
    const prepared = await mapWithConcurrency(
      usable.valid,
      PASSWORD_HASH_CONCURRENCY,
      async (row): Promise<PreparedImportRow> => {
        const tempPassword = this.generateTempPassword();
        return {
          ...row,
          tempPassword,
          passwordHash: await bcrypt.hash(tempPassword, 10),
        };
      },
    );

    const created: BulkImportRowResult[] = [];
    // Each entry holds the very object pushed into `created`, so recording the
    // delivery outcome later survives the sort below.
    const pendingEmails: {
      result: BulkImportRowResult;
      payload: Parameters<MailService['sendAccountCreated']>[0];
    }[] = [];

    // Each row keeps its own transaction, so one bad row still cannot roll
    // back the rest of the roster.
    await mapWithConcurrency(
      prepared,
      ACCOUNT_INSERT_CONCURRENCY,
      async (row) => {
        try {
          await this.insertAccount(row);
        } catch (err) {
          failed.push({
            row: row.rowNumber,
            email: row.data.email,
            reason: this.describeCreateFailure(
              err,
              row.data.role,
              row.data.code,
            ),
          });
          return;
        }

        const result: BulkImportRowResult = {
          row: row.rowNumber,
          email: row.data.email,
          role: row.data.role,
          ...(row.warnings?.length && { warnings: row.warnings }),
        };
        created.push(result);
        pendingEmails.push({
          result,
          payload: {
            to: row.data.email,
            fullName: row.data.fullName,
            tempPassword: row.tempPassword,
            role: row.data.role,
          },
        });
      },
    );

    // Delivery stays best-effort — a failed send never fails the import — but
    // the temp password exists nowhere else, so swallowing the failure strands
    // an account nobody can reach. Record it per row instead.
    await mapWithConcurrency(
      pendingEmails,
      MAIL_SEND_CONCURRENCY,
      async ({ result, payload }) => {
        result.emailSent = await this.mailService.sendAccountCreated(payload);
      },
    );

    // Rows finish out of order once inserts run concurrently, but the admin
    // reads these side by side with the spreadsheet — hand them back in row
    // order.
    created.sort(byRowNumber);
    failed.sort(byRowNumber);

    return {
      total: rows.length,
      createdCount: created.length,
      failedCount: failed.length,
      emailsFailedCount: created.filter((row) => !row.emailSent).length,
      warnedCount: created.filter((row) => row.warnings?.length).length,
      created,
      failed,
    };
  }

  // ── update ────────────────────────────────────────────────

  async update(id: number, dto: UpdateUserDto, actorId: number) {
    const user = await this.findOne(id);

    if (dto.email) {
      const conflict = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (conflict && conflict.id !== id) {
        throw new ConflictException('Email already in use');
      }
    }

    if (dto.role && dto.role !== user.role) {
      this.requireProfileForRole(dto.role, user);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: dto,
        select: USER_SELECT,
      });

      await recordAudit(tx, {
        userId: actorId,
        action: 'UPDATE_USER',
        targetTable: 'users',
        targetId: id,
        // Only the fields that actually moved, so the entry reads as the change
        // rather than as a snapshot somebody has to diff by eye.
        oldValue: {
          ...(dto.email !== undefined && { email: user.email }),
          ...(dto.role !== undefined && { role: user.role }),
          ...(dto.isActive !== undefined && { isActive: user.isActive }),
        },
        newValue: { ...dto },
      });

      return updated;
    });
  }

  /**
   * A role is only worth changing to one the account can actually be.
   *
   * Every relation in this system points at a profile, not at the account: a
   * lecturer's topics hang off LecturerProfile, a student's groups off
   * StudentProfile. Changing the role without one leaves an account its own role
   * has no room for — a lecturer who cannot own a topic, a student who cannot
   * join a group — and nothing downstream would notice until somebody tried.
   *
   * Refused rather than fixed up, because the profile cannot be created first:
   * both profile endpoints check the current role, so the only order that could
   * work is this one being blocked. In practice that means somebody genuinely
   * changing what a person does gets a second account, which is the honest answer
   * — their student record and their lecturer record are different people as far
   * as every foreign key here is concerned. The one case this still allows is
   * changing back: a lecturer briefly made an admin keeps their profile, so the
   * mistake can be undone.
   */
  private requireProfileForRole(
    role: Role,
    // Only whether each block is there, never what is in it.
    user: { studentProfile: object | null; lecturerProfile: object | null },
  ): void {
    if (role === 'ADMIN') return;

    const profile =
      role === 'STUDENT' ? user.studentProfile : user.lecturerProfile;

    if (profile) return;

    throw new ConflictException(
      role === 'STUDENT'
        ? 'Tài khoản này chưa có hồ sơ sinh viên, nên chuyển sang vai trò sinh viên sẽ tạo ra một tài khoản không dùng được. Tạo tài khoản sinh viên mới thay vì đổi vai trò.'
        : 'Tài khoản này chưa có hồ sơ giảng viên, nên chuyển sang vai trò giảng viên sẽ tạo ra một tài khoản không dùng được. Tạo tài khoản giảng viên mới thay vì đổi vai trò.',
    );
  }

  // ── remove ────────────────────────────────────────────────

  /**
   * Deactivates rather than deletes.
   *
   * A hard delete cannot survive contact with this schema: audit_logs.userId is
   * ON DELETE RESTRICT precisely so a record of who changed a grade cannot be
   * erased, and a student who has joined a group is held by RESTRICT there too.
   * Removing an account that has done anything would therefore fail — and where
   * it did succeed, it would take the audit trail with it.
   *
   * FR_ADM_01 asks for "khóa (deactivate)" alongside delete; this is that.
   * Reactivation goes through PATCH /users/:id with isActive.
   */
  async remove(id: number, actorId: number) {
    const user = await this.findOne(id);

    if (!user.isActive) {
      throw new ConflictException(`User #${id} is already deactivated`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { isActive: false } });

      // Deactivation has to take effect now, not whenever the current access
      // token happens to expire.
      await tx.refreshToken.deleteMany({ where: { userId: id } });

      await recordAudit(tx, {
        userId: actorId,
        action: 'DEACTIVATE_USER',
        targetTable: 'users',
        targetId: id,
        oldValue: { email: user.email, role: user.role, isActive: true },
        newValue: { isActive: false },
      });
    });

    return { message: `User #${id} deactivated successfully` };
  }

  // ── resetPassword ─────────────────────────────────────────

  async resetPassword(id: number, actorId: number) {
    const user = await this.findOne(id);

    // Same pattern as create(): admin never sets the password directly — a
    // fresh temp password is generated and delivered by email.
    const tempPassword = this.generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { password: passwordHash, mustChangePassword: true },
      });

      // Revoke all refresh tokens so the user must re-login
      await tx.refreshToken.deleteMany({ where: { userId: id } });

      // The one action here somebody reports as an intrusion — "my password
      // changed and I did not do it" — so who did it and when is the whole
      // question. Nothing about the password itself is recorded.
      await recordAudit(tx, {
        userId: actorId,
        action: 'RESET_USER_PASSWORD',
        targetTable: 'users',
        targetId: id,
        newValue: { email: user.email, mustChangePassword: true },
      });
    });

    await this.mailService.sendPasswordReset({
      to: user.email,
      fullName: user.studentProfile?.fullName ?? user.lecturerProfile?.fullName,
      tempPassword,
      role: user.role,
    });

    return { message: 'Password reset successfully' };
  }

  // ── upsertStudentProfile ──────────────────────────────────

  async upsertStudentProfile(
    id: number,
    dto: UpsertStudentProfileDto,
    actorId: number,
  ) {
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

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.studentProfile.findUnique({
        where: { userId: id },
        select: {
          studentCode: true,
          fullName: true,
          class: true,
          cohort: true,
        },
      });

      const profile = await tx.studentProfile.upsert({
        where: { userId: id },
        create: { userId: id, ...dto },
        update: dto,
      });

      // Audited because the student code is not a label: the intake read out of
      // it decides which round this person may register in, so correcting one is
      // a change to what they are allowed to do, not to how they are spelled.
      await recordAudit(tx, {
        userId: actorId,
        action: 'UPDATE_STUDENT_PROFILE',
        targetTable: 'student_profiles',
        targetId: profile.id,
        ...(before && { oldValue: before }),
        newValue: {
          studentCode: profile.studentCode,
          fullName: profile.fullName,
          class: profile.class,
          cohort: profile.cohort,
        },
      });

      return profile;
    });
  }

  // ── upsertLecturerProfile ─────────────────────────────────

  async upsertLecturerProfile(
    id: number,
    dto: UpsertLecturerProfileDto,
    actorId: number,
  ) {
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

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.lecturerProfile.findUnique({
        where: { userId: id },
        select: {
          lecturerCode: true,
          fullName: true,
          academicTitle: true,
          maxMentoringQuota: true,
        },
      });

      const profile = await tx.lecturerProfile.upsert({
        where: { userId: id },
        create: { userId: id, ...dto },
        update: dto,
      });

      // The mentoring quota is the reason this one is audited: it is the number
      // that decides whether a lecturer may accept another proposal, so lowering
      // it is a decision about somebody else's workload that they did not make.
      await recordAudit(tx, {
        userId: actorId,
        action: 'UPDATE_LECTURER_PROFILE',
        targetTable: 'lecturer_profiles',
        targetId: profile.id,
        ...(before && { oldValue: before }),
        newValue: {
          lecturerCode: profile.lecturerCode,
          fullName: profile.fullName,
          academicTitle: profile.academicTitle,
          maxMentoringQuota: profile.maxMentoringQuota,
        },
      });

      return profile;
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

  /**
   * Validates and de-duplicates every row against one prefetch of the majors
   * table. Pure CPU work beyond that single prefetch.
   */
  private async validateImportRows(rows: ParsedImportRow[]): Promise<{
    valid: ValidatedImportRow[];
    failed: BulkImportRowResult[];
  }> {
    const majors = await this.prisma.major.findMany({
      select: { id: true, code: true },
    });
    const majorIdByCode = new Map(majors.map((m) => [m.code, m.id]));

    const valid: ValidatedImportRow[] = [];
    const failed: BulkImportRowResult[] = [];
    const emailsSeenInFile = new Set<string>();
    // Student and lecturer codes live in separate tables with separate unique
    // indexes, so the same string under both roles is not a collision.
    const codesSeenInFile = new Set<string>();
    // One class belongs to one major, so the first row to use a class code sets
    // what that code means for the rest of the file. This is the only check
    // available on the major half of a class code: its suffix (`PM`) is not the
    // major's own code (`KTPM`), and the faculty's mapping between them is not
    // data the system holds.
    const majorByClassCode = new Map<string, { code: string; row: number }>();

    for (const raw of rows) {
      const parsed = ImportRowSchema.safeParse(toImportRowInput(raw.values));

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

      const codeKey = `${data.role}:${data.code}`;
      if (codesSeenInFile.has(codeKey)) {
        failed.push({
          row: raw.rowNumber,
          email: data.email,
          reason: `Duplicate code "${data.code}" within the file`,
        });
        continue;
      }
      codesSeenInFile.add(codeKey);

      // Only students carry a master-data reference; a lecturer row is
      // self-contained now that bộ môn is gone.
      let majorId: number | undefined;
      const warnings: string[] = [];
      if (data.role === 'STUDENT') {
        majorId = majorIdByCode.get(data.majorCode);
        if (majorId === undefined) {
          failed.push({
            row: raw.rowNumber,
            email: data.email,
            reason: `majorCode "${data.majorCode}" not found`,
          });
          continue;
        }

        const classCheck = checkClassCode(data.class, data.code);

        if (classCheck.status === 'contradiction') {
          failed.push({
            row: raw.rowNumber,
            email: data.email,
            reason: classCheck.error,
          });
          continue;
        }

        if (classCheck.status === 'unrecognised') {
          warnings.push(classCheck.warning);
        }

        if (classCheck.status === 'ok') {
          const { normalised } = classCheck.parsed;
          const claimed = majorByClassCode.get(normalised);

          if (claimed && claimed.code !== data.majorCode) {
            failed.push({
              row: raw.rowNumber,
              email: data.email,
              reason: `class "${data.class}" was majorCode "${claimed.code}" on row ${claimed.row} but "${data.majorCode}" here — one class cannot be two majors`,
            });
            continue;
          }

          if (!claimed) {
            majorByClassCode.set(normalised, {
              code: data.majorCode,
              row: raw.rowNumber,
            });
          }
        }
      }

      valid.push({
        rowNumber: raw.rowNumber,
        data,
        majorId,
        ...(warnings.length && { warnings }),
      });
    }

    return { valid, failed };
  }

  /** Splits out rows whose address is already taken, in a single query. */
  private async rejectTakenEmails(rows: ValidatedImportRow[]): Promise<{
    valid: ValidatedImportRow[];
    failed: BulkImportRowResult[];
  }> {
    if (rows.length === 0) return { valid: [], failed: [] };

    const existing = await this.prisma.user.findMany({
      where: { email: { in: rows.map((row) => row.data.email) } },
      select: { email: true },
    });
    const taken = new Set(existing.map((user) => user.email));

    const valid: ValidatedImportRow[] = [];
    const failed: BulkImportRowResult[] = [];

    for (const row of rows) {
      if (taken.has(row.data.email)) {
        failed.push({
          row: row.rowNumber,
          email: row.data.email,
          reason: 'Email already in use',
        });
      } else {
        valid.push(row);
      }
    }

    return { valid, failed };
  }

  /** Writes one imported account and its role profile atomically. */
  private insertAccount(row: PreparedImportRow) {
    const { data, majorId, passwordHash } = row;

    return this.prisma.$transaction(async (tx) => {
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
            majorId,
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
            academicTitle: data.academicTitle,
            phone: data.phone,
            bio: data.bio,
            researchInterests: data.researchInterests,
          },
        });
      }
    });
  }

  /** Turns a failed row insert into something an admin can act on. */
  private describeCreateFailure(
    err: unknown,
    role: 'STUDENT' | 'LECTURER',
    code: string,
  ): string {
    const conflict = conflictingUniqueFields(err);
    if (!conflict) return 'Unexpected error creating account';

    if (conflict.some((field) => field.includes('email'))) {
      return 'Email already in use';
    }

    const codeLabel = role === 'STUDENT' ? 'Student' : 'Lecturer';
    return conflict.length
      ? `${codeLabel} code "${code}" is already in use`
      : `${codeLabel} code or email is already in use`;
  }

  private generateTempPassword(): string {
    return Array.from(
      { length: TEMP_PASSWORD_LENGTH },
      () => TEMP_PASSWORD_CHARSET[randomInt(TEMP_PASSWORD_CHARSET.length)],
    ).join('');
  }
}
