import {
  Body,
  Controller,
  Delete,
  Get,
  ParseFilePipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { MeService } from './me.service';

/**
 * An avatar is a small square on screen; anything above this is a photograph
 * straight off a phone, which we would only shrink anyway.
 *
 * The cap belongs on multer rather than on a validator, for the same reason as
 * the roster import: multer aborts the stream mid-upload, whereas a validator
 * only gets to look once the whole body is already in memory.
 */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/**
 * Uploading costs storage and CDN quota at a third party, so it is worth a
 * ceiling of its own. Ten a minute is more than anyone choosing a picture will
 * ever need, and far below what it takes to run up a bill.
 */
const AVATAR_UPLOAD_RATE_LIMIT = { default: { limit: 10, ttl: 60_000 } };

/**
 * The signed-in user, about themselves.
 *
 * Every route here takes its subject from the access token and nothing else —
 * there is no id in a path or a body to disagree with it, which is what keeps
 * "edit my profile" from ever becoming "edit anyone's profile". The admin
 * equivalents, which do take an id, live on `/users/:id` behind `@Roles`.
 */
@Controller('me')
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get('profile')
  getProfile(@GetUser('id') userId: number) {
    return this.meService.getProfile(userId);
  }

  @Patch('profile')
  updateProfile(
    @GetUser('id') userId: number,
    @Body() dto: UpdateMyProfileDto,
  ) {
    return this.meService.updateProfile(userId, dto);
  }

  @Throttle(AVATAR_UPLOAD_RATE_LIMIT)
  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_AVATAR_BYTES, files: 1 },
    }),
  )
  setAvatar(
    @GetUser('id') userId: number,
    // `fileIsRequired` rather than a null check in the service: a request with
    // no part named "file" is a malformed request, and 400 is the answer.
    @UploadedFile(new ParseFilePipe({ validators: [], fileIsRequired: true }))
    file: Express.Multer.File,
  ) {
    return this.meService.setAvatar(userId, file);
  }

  @Delete('avatar')
  removeAvatar(@GetUser('id') userId: number) {
    return this.meService.removeAvatar(userId);
  }
}
