import { Module } from '@nestjs/common';
import { StudentRosterService } from './student-roster.service';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

/**
 * `StudentRosterService` is exported and `StudentsService` is not, and the line
 * between them is the point of this module.
 *
 * The roster is the shared answer to "which students, and what are they working
 * on" — the faculty's list and the allocation desk's left-hand column are the
 * same question with different filters, and two implementations of it would be
 * two definitions of what counts as having a topic. What stays private is
 * everything about *this screen*: its query parameters, its pagination, its
 * spreadsheet.
 */
@Module({
  controllers: [StudentsController],
  providers: [StudentsService, StudentRosterService],
  exports: [StudentRosterService],
})
export class StudentsModule {}
