import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { Role } from '../../generated/prisma/client';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { SemestersService } from './semesters.service';
import { CreateSemesterDto } from './dto/create-semester.dto';
import { SetEligibilityDto } from './dto/set-eligibility.dto';
import { UpdateSemesterDto } from './dto/update-semester.dto';

@Controller('semesters')
export class SemestersController {
  constructor(private readonly semestersService: SemestersService) {}

  @Get()
  findAll() {
    return this.semestersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.semestersService.findOne(id);
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() dto: CreateSemesterDto) {
    return this.semestersService.create(dto);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSemesterDto,
  ) {
    return this.semestersService.update(id, dto);
  }

  @Roles('ADMIN')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.semestersService.remove(id);
  }

  @Roles('ADMIN')
  @Patch(':id/activate')
  activate(@Param('id', ParseIntPipe) id: number) {
    return this.semestersService.activate(id);
  }

  // ── Cohort eligibility ────────────────────────────────────

  @Roles('ADMIN')
  @Get(':id/eligibility')
  findEligibility(@Param('id', ParseIntPipe) id: number) {
    return this.semestersService.findEligibility(id);
  }

  @Roles('ADMIN')
  @Put(':id/eligibility')
  setEligibility(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetEligibilityDto,
  ) {
    return this.semestersService.setEligibility(id, dto);
  }

  /**
   * Open to every signed-in role, because each answers for itself: a student
   * gets the kinds of project their cohort may take, staff get the catalogue.
   */
  @Get(':id/eligibility/mine')
  findMyEligibleProjectTypes(
    @Param('id', ParseIntPipe) id: number,
    @GetUser('id') userId: number,
    @GetUser('role') role: Role,
  ) {
    return this.semestersService.findEligibleProjectTypes(id, userId, role);
  }
}
