import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Role } from '../../generated/prisma/client';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ExtendRoundDto } from './dto/extend-round.dto';
import { QueryRoundsDto } from './dto/query-rounds.dto';
import { SetRequirementsDto } from './dto/set-requirements.dto';
import { UnlockRoundDto } from './dto/unlock-round.dto';
import { UpdateRoundDto } from './dto/update-round.dto';
import { RequirementsService } from './requirements.service';
import { RoundsService } from './rounds.service';

@Controller('rounds')
export class RoundsController {
  constructor(
    private readonly roundsService: RoundsService,
    private readonly requirements: RequirementsService,
  ) {}

  /**
   * Readable by every signed-in role. A round carries the faculty's own
   * announcement — which intakes, from when to when — and a student cannot plan
   * around a schedule they are not allowed to see.
   */
  @Get()
  findAll(
    @Query() query: QueryRoundsDto,
    @GetUser('id') userId: number,
    @GetUser('role') role: Role,
  ) {
    return this.roundsService.findAll(query, userId, role);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.roundsService.findOne(id);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoundDto) {
    return this.roundsService.update(id, dto);
  }

  /**
   * Reopen a closed round for the students left without a group.
   *
   * The faculty office's call and nobody else's: it overrides a deadline the
   * whole faculty was told about, and every group already formed keeps running
   * underneath it.
   */
  @Roles('ADMIN')
  @Post(':id/extend')
  extend(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ExtendRoundDto,
    @GetUser('id') userId: number,
  ) {
    return this.roundsService.extend(id, dto, userId);
  }

  /**
   * Reopen the allocation of a round that has already been settled.
   *
   * Admin only, and the narrowest door in this controller: it takes back an
   * outcome every student in the round has already been told is final. What
   * makes that acceptable is the record it leaves — who, when, and the reason
   * they had to type.
   */
  /**
   * What this round's groups must hand in, and by when.
   *
   * Readable by everyone signed in — it is the faculty's own announcement, and
   * a student cannot plan around a deadline they are not allowed to see.
   */
  @Get(':id/requirements')
  findRequirements(@Param('id', ParseIntPipe) id: number) {
    return this.requirements.findForRound(id);
  }

  /**
   * Replaces that list. The faculty office's, not a supervisor's: two students
   * of one intake with different deadlines because they chose different
   * supervisors is a complaint nobody can answer.
   */
  @Roles('ADMIN')
  @Put(':id/requirements')
  setRequirements(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetRequirementsDto,
    @GetUser('id') userId: number,
  ) {
    return this.requirements.setForRound(id, dto, userId);
  }

  @Roles('ADMIN')
  @Post(':id/unlock')
  unlock(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UnlockRoundDto,
    @GetUser('id') userId: number,
  ) {
    return this.roundsService.unlock(id, dto, userId);
  }
}
