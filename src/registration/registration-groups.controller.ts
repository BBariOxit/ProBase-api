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
import { QueryMyGroupDto } from './dto/query-my-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { RegistrationGroupsService } from './registration-groups.service';

@Controller('registration-groups')
export class RegistrationGroupsController {
  constructor(private readonly groups: RegistrationGroupsService) {}

  /**
   * Declared before `:id` on purpose — Nest matches in order, so the
   * parameterised route below would otherwise swallow these paths and hand
   * ParseIntPipe the string "me".
   */
  @Roles('STUDENT')
  @Get('me')
  findMine(@Query() query: QueryMyGroupDto, @GetUser('id') userId: number) {
    return this.groups.findMine(query, userId);
  }

  /**
   * What a link leads to. Read-only, so the page can show the topic and who is
   * already in the group before the visitor spends their one registration.
   */
  @Roles('STUDENT')
  @Get('join/:code')
  previewByCode(@Param('code') code: string, @GetUser('id') userId: number) {
    return this.groups.previewByCode(code, userId);
  }

  /**
   * Join by link. POST rather than GET because it changes something, and the
   * code stays in the path so the whole link is one thing to paste into a chat.
   */
  @Roles('STUDENT')
  @Post('join/:code')
  joinByCode(@Param('code') code: string, @GetUser('id') userId: number) {
    return this.groups.joinByCode(code, userId);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @GetUser('id') userId: number,
    @GetUser('role') role: Role,
  ) {
    return this.groups.findOne(id, userId, role);
  }

  /** Leader only: name, whether to keep taking people, hold, handover. */
  @Roles('STUDENT')
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGroupDto,
    @GetUser('id') userId: number,
  ) {
    return this.groups.update(id, dto, userId);
  }

  @Roles('STUDENT')
  @Post(':id/leave')
  leave(@Param('id', ParseIntPipe) id: number, @GetUser('id') userId: number) {
    return this.groups.leave(id, userId);
  }

  /** Leader only, and audited: taking someone's place away from them. */
  @Roles('STUDENT')
  @Delete(':id/members/:studentId')
  removeMember(
    @Param('id', ParseIntPipe) id: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @GetUser('id') userId: number,
  ) {
    return this.groups.removeMember(id, studentId, userId);
  }

  /**
   * ADMIN is here for the same reason it can edit any topic: the faculty office
   * has to be able to clear up after a group that stopped answering.
   */
  @Roles('STUDENT', 'ADMIN')
  @Delete(':id')
  disband(
    @Param('id', ParseIntPipe) id: number,
    @GetUser('id') userId: number,
    @GetUser('role') role: Role,
  ) {
    return this.groups.disband(id, userId, role);
  }
}
