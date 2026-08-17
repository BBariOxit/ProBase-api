import { Module } from '@nestjs/common';
import { SemesterPhaseService } from './semester-phase.service';
import { SemestersController } from './semesters.controller';
import { SemestersService } from './semesters.service';

/**
 * SemesterPhaseService is exported rather than kept private: the phase gates
 * registration, and later the allocation desk, and a second implementation of
 * the lazy advance is a second chance for two parts of the system to disagree
 * about which stage a semester is at.
 */
@Module({
  controllers: [SemestersController],
  providers: [SemestersService, SemesterPhaseService],
  exports: [SemestersService, SemesterPhaseService],
})
export class SemestersModule {}
