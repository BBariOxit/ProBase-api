import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectTypeDto } from './dto/create-project-type.dto';
import { UpdateProjectTypeDto } from './dto/update-project-type.dto';

@Injectable()
export class ProjectTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.projectType.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { rounds: true, topicProposals: true } },
      },
    });
  }

  async findOne(id: number) {
    const projectType = await this.prisma.projectType.findUnique({
      where: { id },
      include: {
        _count: { select: { rounds: true, topicProposals: true } },
      },
    });

    if (!projectType) throw new NotFoundException('Project type not found');

    return projectType;
  }

  async create(dto: CreateProjectTypeDto) {
    await this.checkDuplicateCode(dto.code);

    return this.prisma.projectType.create({
      data: { name: dto.name, code: dto.code },
    });
  }

  async update(id: number, dto: UpdateProjectTypeDto) {
    await this.findOne(id);

    if (dto.code) {
      await this.checkDuplicateCode(dto.code, id);
    }

    return this.prisma.projectType.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: number) {
    const projectType = await this.prisma.projectType.findUnique({
      where: { id },
      include: { _count: { select: { rounds: true, topicProposals: true } } },
    });

    if (!projectType) throw new NotFoundException('Project type not found');

    // Counted through rounds rather than topics: a topic reaches its kind of
    // project through the round it sits in, so a round is what stands between
    // this row and the work built on it. Deleting one out from under a live
    // round would take its topics with it.
    if (
      projectType._count.rounds > 0 ||
      projectType._count.topicProposals > 0
    ) {
      throw new ConflictException(
        'Cannot delete project type with existing registration rounds or proposals',
      );
    }

    return this.prisma.projectType.delete({ where: { id } });
  }

  private async checkDuplicateCode(code: string, excludeId?: number) {
    const existing = await this.prisma.projectType.findUnique({
      where: { code },
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`Project type code "${code}" already exists`);
    }
  }
}
