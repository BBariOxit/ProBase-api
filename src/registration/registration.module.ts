import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RoundsModule } from '../rounds/rounds.module';
import { RegistrationGroupsController } from './registration-groups.controller';
import { RegistrationGroupsService } from './registration-groups.service';
import { TopicRegistrationController } from './topic-registration.controller';

/**
 * Imports RoundsModule for RoundPhaseService rather than owning it. The phase
 * belongs to the round — registration is one of the things it gates, not the
 * thing that defines it.
 */
@Module({
  imports: [RoundsModule, NotificationsModule],
  controllers: [RegistrationGroupsController, TopicRegistrationController],
  providers: [RegistrationGroupsService],
  exports: [RegistrationGroupsService],
})
export class RegistrationModule {}
