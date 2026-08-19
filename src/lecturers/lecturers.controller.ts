import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import type { Role } from '../../generated/prisma/client';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { QueryLecturersDto } from './dto/query-lecturers.dto';
import { LecturersService } from './lecturers.service';

/**
 * Readable by anyone signed in — a student choosing a topic is choosing a
 * supervisor, and until recently the only thing the system would tell them about
 * that decision was a name with a title in front of it.
 *
 * Neither route is role-gated, and that is a decision rather than an oversight:
 * what they return is a staff directory of the kind a faculty publishes on its
 * own website. The judgement about what stays back — addresses, phone numbers —
 * is made in the service, per reader, and applies the same to both.
 */
@Controller('lecturers')
export class LecturersController {
  constructor(private readonly lecturersService: LecturersService) {}

  @Get()
  findAll(@Query() query: QueryLecturersDto) {
    return this.lecturersService.findAll(query);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @GetUser('id') userId: number,
    @GetUser('role') role: Role,
  ) {
    return this.lecturersService.findOne(id, { userId, role });
  }
}
