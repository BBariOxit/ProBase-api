import { Module } from '@nestjs/common';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RoundsModule } from '../rounds/rounds.module';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';

/**
 * CloudinaryModule for the storage seam rather than for Cloudinary: what this
 * module knows is that a document goes in and a URL plus a handle comes back.
 * Swapping the provider is a change inside that service and nothing here.
 *
 * RoundsModule for the requirement list. What a group may hand in is the
 * faculty's declaration on their round, and this module borrows the answer
 * rather than reading the table itself — a second definition of "is this
 * document part of this đợt" is a second place for the check to be forgotten.
 */
@Module({
  imports: [CloudinaryModule, NotificationsModule, RoundsModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
})
export class SubmissionsModule {}
