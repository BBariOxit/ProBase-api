import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Exported because raising a notice belongs to whatever caused it. Registration
 * knows somebody joined a group; rounds know a gate reopened. A module that
 * tried to work that out for itself would be watching the database for changes
 * it has no business inferring.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
