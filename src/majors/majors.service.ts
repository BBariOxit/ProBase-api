import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMajorDto } from './dto/create-major.dto';
import { UpdateMajorDto } from './dto/update-major.dto';

@Injectable()
export class MajorsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(departmentId?: number) {
    return this.prisma.major.findMany({
      where: departmentId ? { departmentId } : undefined,
      orderBy: { name: 'asc' },
      include: {
        department: { select: { id: true, name: true, code: true } },
        _count: { select: { students: true } },
      },
    });
  }

  async findOne(id: number) {
    const major = await this.prisma.major.findUnique({
      where: { id },
      include: {
        department: { select: { id: true, name: true, code: true } },
        _count: { select: { students: true } },
      },
    });

    if (!major) throw new NotFoundException('Major not found');

    return major;
  }

  async create(dto: CreateMajorDto) {
    await this.ensureDepartmentExists(dto.departmentId);
    await this.checkDuplicateCode(dto.code);

    return this.prisma.major.create({
      data: { name: dto.name, code: dto.code, departmentId: dto.departmentId },
      include: {
        department: { select: { id: true, name: true, code: true } },
      },
    });
  }

  async update(id: number, dto: UpdateMajorDto) {
    await this.findOne(id);

    if (dto.departmentId) {
      await this.ensureDepartmentExists(dto.departmentId);
    }

    if (dto.code) {
      await this.checkDuplicateCode(dto.code, id);
    }

    return this.prisma.major.update({
      where: { id },
      data: dto,
      include: {
        department: { select: { id: true, name: true, code: true } },
      },
    });
  }

  async remove(id: number) {
    const major = await this.prisma.major.findUnique({
      where: { id },
      include: { _count: { select: { students: true } } },
    });

    if (!major) throw new NotFoundException('Major not found');

    if (major._count.students > 0) {
      throw new ConflictException('Cannot delete major with existing students');
    }

    return this.prisma.major.delete({ where: { id } });
  }

  private async ensureDepartmentExists(departmentId: number) {
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
    });
    if (!department) throw new NotFoundException('Department not found');
  }

  private async checkDuplicateCode(code: string, excludeId?: number) {
    const existing = await this.prisma.major.findUnique({ where: { code } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`Major code "${code}" already exists`);
    }
  }
}
