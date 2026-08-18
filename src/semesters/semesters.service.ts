import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RoundsService } from '../rounds/rounds.service';
import { CreateSemesterDto } from './dto/create-semester.dto';
import { UpdateSemesterDto } from './dto/update-semester.dto';

@Injectable()
export class SemestersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rounds: RoundsService,
  ) {}

  /**
   * The terms themselves. Registration state is not here on purpose: a semester
   * runs several rounds at once and they open, close and settle independently,
   * so there is no single "is registration open" to report at this level. Ask
   * `/rounds` for that.
   */
  findAll() {
    return this.prisma.semester.findMany({
      orderBy: { startDate: 'desc' },
      include: {
        _count: {
          select: { rounds: true, topics: true, registrationGroups: true },
        },
      },
    });
  }

  async findOne(id: number) {
    const semester = await this.prisma.semester.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            rounds: true,
            topics: true,
            topicProposals: true,
            registrationGroups: true,
            councils: true,
          },
        },
      },
    });

    if (!semester) throw new NotFoundException('Semester not found');

    // The plan comes along with the term, because "what is open this semester"
    // is the first thing anyone opening it wants to know, and the phases are
    // brought up to date on the way out.
    return { ...semester, rounds: await this.rounds.findForSemester(id) };
  }

  async create(dto: CreateSemesterDto) {
    await this.checkDuplicateCode(dto.code);

    return this.prisma.semester.create({ data: dto });
  }

  async update(id: number, dto: UpdateSemesterDto) {
    const semester = await this.requireSemester(id);

    if (dto.code) {
      await this.checkDuplicateCode(dto.code, id);
    }

    // Checked against the merged row rather than the payload. A PATCH that sends
    // only one of the two dates cannot be validated against itself, and a schema
    // refinement never sees the value it is being compared with — so moving a
    // start date past an untouched end date used to be accepted in silence.
    const startDate = dto.startDate ?? semester.startDate;
    const endDate = dto.endDate ?? semester.endDate;

    if (endDate <= startDate) {
      throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu');
    }

    return this.prisma.semester.update({ where: { id }, data: dto });
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
    await this.requireSemester(id);

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

  private async requireSemester(id: number) {
    const semester = await this.prisma.semester.findUnique({
      where: { id },
      select: { id: true, startDate: true, endDate: true },
    });

    if (!semester) throw new NotFoundException('Semester not found');

    return semester;
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
