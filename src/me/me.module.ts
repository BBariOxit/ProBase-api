import { Module } from '@nestjs/common';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [CloudinaryModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
