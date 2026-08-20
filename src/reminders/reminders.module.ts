import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RoundsModule } from '../rounds/rounds.module';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';

/**
 * A module of its own rather than a job hidden inside rounds or submissions.
 *
 * What it does spans both — the gate closing and a report falling due are the
 * same kind of event to the person being reminded — and neither of those modules
 * should acquire a clock as a side effect of owning a date. Keeping it here also
 * means there is one place to look when the question is "what does this system
 * send on its own".
 *
 * Nothing is exported: a reminder is raised by the schedule, or by the office
 * pressing the button on the controller, and there is no third caller.
 */
@Module({
  imports: [NotificationsModule, RoundsModule],
  controllers: [RemindersController],
  providers: [RemindersService],
})
export class RemindersModule {}
