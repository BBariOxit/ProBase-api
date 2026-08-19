import { Module } from '@nestjs/common';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';

/**
 * CloudinaryModule for the storage seam rather than for Cloudinary: what this
 * module knows is that a document goes in and a URL plus a handle comes back.
 * Swapping the provider is a change inside that service and nothing here.
 */
@Module({
  imports: [CloudinaryModule, NotificationsModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
})
export class SubmissionsModule {}
