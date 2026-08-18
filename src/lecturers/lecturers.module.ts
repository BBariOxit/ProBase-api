import { Module } from '@nestjs/common';
import { LecturersController } from './lecturers.controller';
import { LecturersService } from './lecturers.service';

@Module({
  controllers: [LecturersController],
  providers: [LecturersService],
})
export class LecturersModule {}
