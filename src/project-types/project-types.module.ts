import { Module } from '@nestjs/common';
import { ProjectTypesController } from './project-types.controller';
import { ProjectTypesService } from './project-types.service';

@Module({
  controllers: [ProjectTypesController],
  providers: [ProjectTypesService],
  exports: [ProjectTypesService],
})
export class ProjectTypesModule {}
