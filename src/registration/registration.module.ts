import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RoundsModule } from '../rounds/rounds.module';
import { StudentsModule } from '../students/students.module';
import { AllocationController } from './allocation.controller';
import { AllocationService } from './allocation.service';
import { RegistrationGroupsController } from './registration-groups.controller';
import { RegistrationGroupsService } from './registration-groups.service';
import { TopicRegistrationController } from './topic-registration.controller';

/**
 * Imports RoundsModule for RoundPhaseService rather than owning it. The phase
 * belongs to the round — registration is one of the things it gates, not the
 * thing that defines it.
 *
 * The faculty office's allocation desk lives here rather than in RoundsModule
 * even though its routes hang off `/rounds/:id`: what it actually writes is
 * group membership, and putting it next to the round would have meant a second
 * implementation of seat arithmetic — the thing this module exists to own.
 * AllocationService is deliberately not exported: it is the one path into a
 * group that skips the rules protecting students from each other, and nothing
 * outside this module has any business calling it.
 */
@Module({
  imports: [RoundsModule, NotificationsModule, StudentsModule],
  controllers: [
    RegistrationGroupsController,
    TopicRegistrationController,
    AllocationController,
  ],
  providers: [RegistrationGroupsService, AllocationService],
  exports: [RegistrationGroupsService],
})
export class RegistrationModule {}
