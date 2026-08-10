import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.department.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { majors: true, lecturers: true } },
      },
    });
  }

  async findOne(id: number) {
    const department = await this.prisma.department.findUnique({
      where: { id },
      include: {
        majors: { orderBy: { name: 'asc' } },
        _count: { select: { majors: true, lecturers: true } },
      },
    });

    if (!department) throw new NotFoundException('Department not found');

    return department;
  }

  async create(dto: CreateDepartmentDto) {
    await this.checkDuplicateCode(dto.code);

    return this.prisma.department.create({
      data: { name: dto.name, code: dto.code },
    });
  }

  async update(id: number, dto: UpdateDepartmentDto) {
    await this.findOne(id);

    if (dto.code) {
      await this.checkDuplicateCode(dto.code, id);
    }

    return this.prisma.department.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: number) {
    await this.findOne(id);

    const usage = await this.prisma.department.findUnique({
      where: { id },
      include: {
        _count: { select: { majors: true, lecturers: true } },
      },
    });

    if (usage && (usage._count.majors > 0 || usage._count.lecturers > 0)) {
      throw new ConflictException(
        'Cannot delete department with existing majors or lecturers',
      );
    }

    return this.prisma.department.delete({ where: { id } });
  }

  private async checkDuplicateCode(code: string, excludeId?: number) {
    const existing = await this.prisma.department.findUnique({
      where: { code },
    });

    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`Department code "${code}" already exists`);
    }
  }
}
