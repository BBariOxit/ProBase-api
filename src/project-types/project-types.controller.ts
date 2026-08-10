import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { ProjectTypesService } from './project-types.service';
import { CreateProjectTypeDto } from './dto/create-project-type.dto';
import { UpdateProjectTypeDto } from './dto/update-project-type.dto';

@Controller('project-types')
export class ProjectTypesController {
  constructor(private readonly projectTypesService: ProjectTypesService) {}

  @Get()
  findAll() {
    return this.projectTypesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.projectTypesService.findOne(id);
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() dto: CreateProjectTypeDto) {
    return this.projectTypesService.create(dto);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProjectTypeDto,
  ) {
    return this.projectTypesService.update(id, dto);
  }

  @Roles('ADMIN')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.projectTypesService.remove(id);
  }
}
