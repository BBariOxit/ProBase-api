import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RequirementsService } from './requirements.service';
import { RoundPhaseService } from './round-phase.service';
import { RoundsController } from './rounds.controller';
import { RoundsService } from './rounds.service';

/**
 * Both services are exported rather than kept private.
 *
 * The phase gates registration, topic availability and later the allocation
 * desk, and a second implementation of the lazy advance would be a second chance
 * for two parts of the system to disagree about which stage a round is at.
 * RoundsService goes out for the same reason: the semester endpoints publish a
 * faculty's plan, and it is the same plan.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [RoundsController],
  providers: [RoundsService, RoundPhaseService, RequirementsService],
  exports: [RoundsService, RoundPhaseService, RequirementsService],
})
export class RoundsModule {}
