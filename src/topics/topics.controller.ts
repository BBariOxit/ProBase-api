import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '../../generated/prisma/client';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateTopicDto } from './dto/create-topic.dto';
import { QueryTopicLecturersDto } from './dto/query-topic-lecturers.dto';
import { QueryTopicsDto } from './dto/query-topics.dto';
import { UpdateTopicDto } from './dto/update-topic.dto';
import { TopicsService } from './topics.service';

@Controller('topics')
export class TopicsController {
  constructor(private readonly topicsService: TopicsService) {}

  /**
   * Open to every signed-in role, but not to the same extent: the service
   * narrows a student's view to published topics before it queries.
   */
  @Get()
  findAll(
    @Query() query: QueryTopicsDto,
    @GetUser('id') userId: number,
    @GetUser('role') role: Role,
  ) {
    return this.topicsService.findAll(query, userId, role);
  }

  /**
   * Declared before the `:id` route on purpose. Nest matches in order, so the
   * parameterised route would otherwise swallow this path and hand
   * ParseIntPipe the string "lecturers".
   */
  @Get('lecturers')
  findLecturers(
    @Query() query: QueryTopicLecturersDto,
    @GetUser('role') role: Role,
  ) {
    return this.topicsService.findLecturers(role, query.semesterId);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @GetUser('id') userId: number,
    @GetUser('role') role: Role,
  ) {
    return this.topicsService.findOne(id, userId, role);
  }

  @Roles('LECTURER')
  @Post()
  create(@Body() dto: CreateTopicDto, @GetUser('id') userId: number) {
    return this.topicsService.create(dto, userId);
  }

  @Roles('LECTURER', 'ADMIN')
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTopicDto,
    @GetUser('id') userId: number,
    @GetUser('role') role: Role,
  ) {
    return this.topicsService.update(id, dto, userId, role);
  }

  @Roles('LECTURER', 'ADMIN')
  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @GetUser('id') userId: number,
    @GetUser('role') role: Role,
  ) {
    return this.topicsService.remove(id, userId, role);
  }

  @Roles('ADMIN')
  @Patch(':id/approve')
  approve(@Param('id', ParseIntPipe) id: number) {
    return this.topicsService.approve(id);
  }

  @Roles('LECTURER', 'ADMIN')
  @Patch(':id/open')
  open(
    @Param('id', ParseIntPipe) id: number,
    @GetUser('id') userId: number,
    @GetUser('role') role: Role,
  ) {
    return this.topicsService.open(id, userId, role);
  }

  @Roles('LECTURER', 'ADMIN')
  @Patch(':id/close')
  close(
    @Param('id', ParseIntPipe) id: number,
    @GetUser('id') userId: number,
    @GetUser('role') role: Role,
  ) {
    return this.topicsService.close(id, userId, role);
  }
}
