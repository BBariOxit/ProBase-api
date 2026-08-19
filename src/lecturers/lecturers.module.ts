import { Module } from '@nestjs/common';
import { LecturersController } from './lecturers.controller';
import { LecturersService } from './lecturers.service';
import { MentoringLoadService } from './mentoring-load.service';

/**
 * The mentoring load is exported because two other modules ask the same
 * question: `/me/profile` shows a lecturer their own, and answering a proposal
 * has to refuse one that would go over the faculty's ceiling. A second count
 * written elsewhere would be a second definition of what "đang hướng dẫn 4 nhóm"
 * means.
 */
@Module({
  controllers: [LecturersController],
  providers: [LecturersService, MentoringLoadService],
  exports: [MentoringLoadService],
})
export class LecturersModule {}
