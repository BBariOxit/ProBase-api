import { Module } from '@nestjs/common';
import { RoundsModule } from '../rounds/rounds.module';
import { SemestersController } from './semesters.controller';
import { SemestersService } from './semesters.service';

/**
 * Imports RoundsModule rather than owning the rounds itself. A term's
 * registration plan is published under `/semesters/:id/rounds` because that is
 * how the office thinks of it, but it is the same plan `/rounds` serves, and one
 * implementation is what keeps the two from drifting apart.
 */
@Module({
  imports: [RoundsModule],
  controllers: [SemestersController],
  providers: [SemestersService],
  exports: [SemestersService],
})
export class SemestersModule {}
