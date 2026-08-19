import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { ZodValidationPipe } from 'nestjs-zod';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateUserSchema } from './dto/create-user.dto';
import type { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpsertLecturerProfileDto } from './dto/upsert-lecturer-profile.dto';
import { UpsertStudentProfileDto } from './dto/upsert-student-profile.dto';
import { UsersService } from './users.service';

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

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

  // Body shape depends on `role`, so validation goes through the union schema
  // directly rather than the global pipe's DTO-class lookup.
  @Post()
  create(
    @Body(new ZodValidationPipe(CreateUserSchema)) dto: CreateUserDto,
    @GetUser('id') actorId: number,
  ) {
    return this.usersService.create(dto, actorId);
  }

  // ── Bulk import ───────────────────────────────────────────
  // Accepts an .xlsx or .csv roster of students/lecturers, creates one
  // account per valid row, and emails each a temp password. Bad rows are
  // reported back individually — one bad row never fails the whole batch.

  // The size cap belongs on multer, not on a validator: multer aborts the
  // stream mid-upload, whereas a ParseFilePipe validator only inspects
  // file.size once the whole body is already buffered in memory — which is
  // exactly the memory we are trying not to spend.
  @Post('bulk-import')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMPORT_FILE_BYTES, files: 1 },
    }),
  )
  bulkImport(
    @UploadedFile(new ParseFilePipe({ validators: [], fileIsRequired: true }))
    file: Express.Multer.File,
  ) {
    return this.usersService.bulkImport(file);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
    @GetUser('id') actorId: number,
  ) {
    return this.usersService.update(id, dto, actorId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @GetUser('id') actorId: number,
  ) {
    return this.usersService.remove(id, actorId);
  }

  // ── Admin reset password ──────────────────────────────────

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @GetUser('id') actorId: number,
  ) {
    return this.usersService.resetPassword(id, actorId);
  }

  // ── Profiles ──────────────────────────────────────────────

  @Put(':id/student-profile')
  upsertStudentProfile(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertStudentProfileDto,
    @GetUser('id') actorId: number,
  ) {
    return this.usersService.upsertStudentProfile(id, dto, actorId);
  }

  @Put(':id/lecturer-profile')
  upsertLecturerProfile(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertLecturerProfileDto,
    @GetUser('id') actorId: number,
  ) {
    return this.usersService.upsertLecturerProfile(id, dto, actorId);
  }
}
