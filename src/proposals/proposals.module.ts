import { Module } from '@nestjs/common';
import { LecturersModule } from '../lecturers/lecturers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RoundsModule } from '../rounds/rounds.module';
import { ProposalsController } from './proposals.controller';
import { ProposalsService } from './proposals.service';

/**
 * RoundsModule for both of its exports: the round a proposal belongs to comes
 * from the semester and the kind of project, and the phase decides whether a
 * proposal can still be written or answered. LecturersModule for the mentoring
 * load, which decides whether the lecturer answering has room to say yes.
 */
@Module({
  imports: [RoundsModule, NotificationsModule, LecturersModule],
  controllers: [ProposalsController],
  providers: [ProposalsService],
})
export class ProposalsModule {}
