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
import { MajorsService } from './majors.service';
import { CreateMajorDto } from './dto/create-major.dto';
import { UpdateMajorDto } from './dto/update-major.dto';

@Controller('majors')
export class MajorsController {
  constructor(private readonly majorsService: MajorsService) {}

  @Get()
  findAll() {
    return this.majorsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.majorsService.findOne(id);
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() dto: CreateMajorDto) {
    return this.majorsService.create(dto);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMajorDto) {
    return this.majorsService.update(id, dto);
  }

  @Roles('ADMIN')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.majorsService.remove(id);
  }
}
