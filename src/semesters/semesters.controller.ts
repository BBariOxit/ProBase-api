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
import { SetSemesterRoundsDto } from '../rounds/dto/set-semester-rounds.dto';
import { RoundsService } from '../rounds/rounds.service';
import { SemestersService } from './semesters.service';
import { CreateSemesterDto } from './dto/create-semester.dto';
import { UpdateSemesterDto } from './dto/update-semester.dto';

@Controller('semesters')
export class SemestersController {
  constructor(
    private readonly semestersService: SemestersService,
    private readonly roundsService: RoundsService,
  ) {}

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
  create(@Body() dto: CreateSemesterDto, @GetUser('id') actorId: number) {
    return this.semestersService.create(dto, actorId);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSemesterDto,
    @GetUser('id') actorId: number,
  ) {
    return this.semestersService.update(id, dto, actorId);
  }

  @Roles('ADMIN')
  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @GetUser('id') actorId: number,
  ) {
    return this.semestersService.remove(id, actorId);
  }

  @Roles('ADMIN')
  @Patch(':id/activate')
  activate(
    @Param('id', ParseIntPipe) id: number,
    @GetUser('id') actorId: number,
  ) {
    return this.semestersService.activate(id, actorId);
  }

  // ── Registration rounds ───────────────────────────────────

  @Get(':id/rounds')
  findRounds(@Param('id', ParseIntPipe) id: number) {
    return this.roundsService.findForSemester(id);
  }

  /**
   * The whole registration plan for a term, in one call: which kind of project
   * is open, to which intakes, and between which dates.
   *
   * Declaring an intake is what creates a round, so there is no separate step
   * that makes one — the same reason registering for a topic is what makes a
   * group.
   */
  @Roles('ADMIN')
  @Put(':id/rounds')
  setRounds(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetSemesterRoundsDto,
    @GetUser('id') actorId: number,
  ) {
    return this.roundsService.setSemesterRounds(id, dto, actorId);
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
    return this.roundsService.findEligibleProjectTypes(id, userId, role);
  }
}
