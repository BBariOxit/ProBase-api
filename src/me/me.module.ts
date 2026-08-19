import { Module } from '@nestjs/common';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { LecturersModule } from '../lecturers/lecturers.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  // LecturersModule for the mentoring load: a lecturer's own profile is the
  // one screen where the faculty's ceiling means anything to them, and it means
  // nothing without the number it is a ceiling on.
  imports: [CloudinaryModule, LecturersModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
