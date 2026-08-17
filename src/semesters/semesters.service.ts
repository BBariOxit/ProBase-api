import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SemesterPhaseService } from './semester-phase.service';
import { CreateSemesterDto } from './dto/create-semester.dto';
import { SetEligibilityDto } from './dto/set-eligibility.dto';
import { UpdateSemesterDto } from './dto/update-semester.dto';

@Injectable()
export class SemestersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phases: SemesterPhaseService,
  ) {}

  /**
   * Phases are brought up to date before the rows go out, so a client cannot be
   * told a semester is still OPEN by the one endpoint whose whole job is to
   * report its state. The advance is a no-op for every semester already on the
   * right phase, which is nearly all of them nearly all of the time.
   */
  async findAll() {
    const semesters = await this.prisma.semester.findMany({
      orderBy: { startDate: 'desc' },
      include: {
        _count: { select: { topics: true, registrationGroups: true } },
      },
    });

    return Promise.all(
      semesters.map(async (semester) => ({
        ...semester,
        phase: await this.phases.resolve(semester.id),
      })),
    );
  }

  async findOne(id: number) {
    const semester = await this.prisma.semester.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            topics: true,
            topicProposals: true,
            registrationGroups: true,
            councils: true,
          },
        },
      },
    });

    if (!semester) throw new NotFoundException('Semester not found');

    return { ...semester, phase: await this.phases.resolve(id) };
  }

  async create(dto: CreateSemesterDto) {
    await this.checkDuplicateCode(dto.code);

    return this.prisma.semester.create({ data: dto });
  }

  async update(id: number, dto: UpdateSemesterDto) {
    await this.findOne(id);

    if (dto.code) {
      await this.checkDuplicateCode(dto.code, id);
    }

    return this.prisma.semester.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: number) {
    const semester = await this.prisma.semester.findUnique({
      where: { id },
      include: {
        _count: { select: { topics: true, registrationGroups: true } },
      },
    });

    if (!semester) throw new NotFoundException('Semester not found');

    if (semester._count.topics > 0 || semester._count.registrationGroups > 0) {
      throw new ConflictException(
        'Cannot delete semester with existing topics or registration groups',
      );
    }

    return this.prisma.semester.delete({ where: { id } });
  }

  async activate(id: number) {
    await this.findOne(id);

    // Deactivate all semesters, then activate the selected one
    await this.prisma.$transaction([
      this.prisma.semester.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      }),
      this.prisma.semester.update({
        where: { id },
        data: { isActive: true },
      }),
    ]);

    return this.prisma.semester.findUnique({ where: { id } });
  }

  /** Which cohort may take which kind of project, for the whole semester. */
  async findEligibility(id: number) {
    await this.requireSemester(id);

    return this.prisma.semesterEligibility.findMany({
      where: { semesterId: id },
      select: {
        id: true,
        cohort: true,
        projectType: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ cohort: 'desc' }, { projectTypeId: 'asc' }],
    });
  }

  /**
   * Replaces the mapping wholesale.
   *
   * Delete-then-insert inside one transaction rather than a diff: the caller
   * sends what the rule should be, and working out which rows that implies is
   * this method's job, not theirs. Duplicate pairs in the payload are dropped
   * before the write, so a spreadsheet paste with a repeated line is accepted
   * rather than rejected on a unique-key violation the caller cannot see.
   */
  async setEligibility(id: number, dto: SetEligibilityDto) {
    await this.requireSemester(id);

    const unique = new Map(
      dto.entries.map((entry) => [
        `${entry.projectTypeId}:${entry.cohort}`,
        entry,
      ]),
    );

    const projectTypeIds = [
      ...new Set([...unique.values()].map((entry) => entry.projectTypeId)),
    ];
    const known = await this.prisma.projectType.findMany({
      where: { id: { in: projectTypeIds } },
      select: { id: true },
    });

    if (known.length !== projectTypeIds.length) {
      const found = new Set(known.map((type) => type.id));
      const missing = projectTypeIds.filter((typeId) => !found.has(typeId));
      throw new NotFoundException(
        `Project type ${missing.join(', ')} not found`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.semesterEligibility.deleteMany({ where: { semesterId: id } }),
      this.prisma.semesterEligibility.createMany({
        data: [...unique.values()].map((entry) => ({
          semesterId: id,
          projectTypeId: entry.projectTypeId,
          cohort: entry.cohort,
        })),
      }),
    ]);

    return this.findEligibility(id);
  }

  /**
   * The kinds of project this particular caller may register for.
   *
   * What the browse screen needs to default its filter to. Staff have no
   * cohort, so they see everything — the rule exists to steer students, not to
   * hide the catalogue from the people running it.
   */
  async findEligibleProjectTypes(id: number, userId: number, role: Role) {
    await this.requireSemester(id);

    if (role !== Role.STUDENT) {
      return this.prisma.projectType.findMany({ orderBy: { code: 'asc' } });
    }

    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { cohort: true },
    });

    // No profile or no cohort means nothing can be said about eligibility, and
    // an empty list is the honest answer — not the whole catalogue.
    if (!profile?.cohort) return [];

    const rows = await this.prisma.semesterEligibility.findMany({
      where: { semesterId: id, cohort: profile.cohort },
      select: { projectType: { select: { id: true, name: true, code: true } } },
      orderBy: { projectType: { code: 'asc' } },
    });

    return rows.map((row) => row.projectType);
  }

  private async requireSemester(id: number) {
    const semester = await this.prisma.semester.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!semester) throw new NotFoundException(`Semester ${id} not found`);
  }

  private async checkDuplicateCode(code: string, excludeId?: number) {
    const existing = await this.prisma.semester.findUnique({
      where: { code },
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`Semester code "${code}" already exists`);
    }
  }
}
