import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
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

  // ── Bulk import ───────────────────────────────────────────
  // Accepts an .xlsx or .csv roster of students/lecturers, creates one
  // account per valid row, and emails each a temp password. Bad rows are
  // reported back individually — one bad row never fails the whole batch.

  @Post('bulk-import')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  bulkImport(
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 })],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.usersService.bulkImport(file);
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
  resetPassword(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.resetPassword(id);
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
