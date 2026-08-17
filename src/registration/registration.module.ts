import { Module } from '@nestjs/common';
import { SemestersModule } from '../semesters/semesters.module';
import { RegistrationGroupsController } from './registration-groups.controller';
import { RegistrationGroupsService } from './registration-groups.service';
import { TopicRegistrationController } from './topic-registration.controller';

/**
 * Imports SemestersModule for SemesterPhaseService rather than owning it. The
 * phase belongs to the semester — registration is one of the things it gates,
 * not the thing that defines it.
 */
@Module({
  imports: [SemestersModule],
  controllers: [RegistrationGroupsController, TopicRegistrationController],
  providers: [RegistrationGroupsService],
  exports: [RegistrationGroupsService],
})
export class RegistrationModule {}
