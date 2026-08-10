import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSemesterDto } from './dto/create-semester.dto';
import { UpdateSemesterDto } from './dto/update-semester.dto';

@Injectable()
export class SemestersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.semester.findMany({
      orderBy: { startDate: 'desc' },
      include: {
        _count: { select: { topics: true, registrationGroups: true } },
      },
    });
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

    return semester;
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

  private async checkDuplicateCode(code: string, excludeId?: number) {
    const existing = await this.prisma.semester.findUnique({
      where: { code },
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`Semester code "${code}" already exists`);
    }
  }
}
