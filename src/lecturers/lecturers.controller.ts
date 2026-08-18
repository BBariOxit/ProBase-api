import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import type { Role } from '../../generated/prisma/client';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { LecturersService } from './lecturers.service';

/**
 * Readable by anyone signed in — a student choosing a topic is choosing a
 * supervisor, and until now the only thing the system would tell them about
 * that person was a name with a title in front of it.
 */
@Controller('lecturers')
export class LecturersController {
  constructor(private readonly lecturersService: LecturersService) {}

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @GetUser('id') userId: number,
    @GetUser('role') role: Role,
  ) {
    return this.lecturersService.findOne(id, { userId, role });
  }
}
