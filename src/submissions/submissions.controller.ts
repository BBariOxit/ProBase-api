import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Role } from '../../generated/prisma/client';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { MAX_DOCUMENT_BYTES } from '../cloudinary/cloudinary.service';
import {
  CreateSubmissionDto,
  QuerySubmissionsDto,
  SubmissionFeedbackDto,
} from './dto/submission.dto';
import { SubmissionsService } from './submissions.service';

/**
 * What a group hands in, and what their supervisor says about it.
 *
 * Both sides read `GET /submissions`: the token decides which end of the
 * exchange you are standing at, so there is no id in the query for anyone to
 * swap. The answering route is `@Roles('LECTURER')` because the role, rather
 * than ownership, is the thing being checked there — ownership of the topic is
 * checked in the service, and answers 404 rather than 403 so that knowing an id
 * never confirms it exists.
 */
@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  /**
   * The size cap belongs on multer rather than on a validator: multer aborts
   * the stream mid-upload, whereas a validator only inspects the size once the
   * whole body is already buffered in memory — which is exactly the memory this
   * is trying not to spend on a twenty-five megabyte report.
   */
  @Roles('STUDENT')
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
    }),
  )
  create(
    @Body() dto: CreateSubmissionDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @GetUser('id') userId: number,
  ) {
    return this.submissionsService.create(dto, file, userId);
  }

  @Get()
  findAll(
    @Query() query: QuerySubmissionsDto,
    @GetUser('id') userId: number,
    @GetUser('role') role: Role,
  ) {
    return this.submissionsService.findAll(query, userId, role);
  }

  @Roles('LECTURER')
  @Post(':id/feedback')
  giveFeedback(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmissionFeedbackDto,
    @GetUser('id') userId: number,
  ) {
    return this.submissionsService.giveFeedback(id, dto, userId);
  }
}
