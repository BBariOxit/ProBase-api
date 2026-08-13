import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpsertLecturerProfileDto } from './dto/upsert-lecturer-profile.dto';
import { UpsertStudentProfileDto } from './dto/upsert-student-profile.dto';
import { UsersService } from './users.service';

@Roles('ADMIN')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ── User CRUD ─────────────────────────────────────────────

  @Get()
  findAll(@Query() query: QueryUsersDto) {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.remove(id);
  }

  // ── Admin reset password ──────────────────────────────────

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.usersService.resetPassword(id, dto);
  }

  // ── Profiles ──────────────────────────────────────────────

  @Put(':id/student-profile')
  upsertStudentProfile(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertStudentProfileDto,
  ) {
    return this.usersService.upsertStudentProfile(id, dto);
  }

  @Put(':id/lecturer-profile')
  upsertLecturerProfile(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertLecturerProfileDto,
  ) {
    return this.usersService.upsertLecturerProfile(id, dto);
  }
}
