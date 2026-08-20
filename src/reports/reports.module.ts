import { Module } from '@nestjs/common';
import { RoundsModule } from '../rounds/rounds.module';
import { StudentsModule } from '../students/students.module';
import { ReportsController } from './reports.controller';
import { ReportsExportService } from './reports-export.service';
import { ReportsService } from './reports.service';

/**
 * Reporting reads from everywhere and owns nothing, which is exactly why it is
 * its own module rather than a method bolted onto each of the modules it counts.
 *
 * It borrows two things rather than reimplementing them: the round's phase, and
 * the roster's definition of "has a topic this term". That second one is the
 * important borrow — a report that counted placed students its own way would
 * eventually print a different number from the screen the office had open
 * beside it, and neither would be obviously wrong.
 */
@Module({
  imports: [RoundsModule, StudentsModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsExportService],
})
export class ReportsModule {}
