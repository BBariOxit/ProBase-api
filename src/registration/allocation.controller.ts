import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AllocationService } from './allocation.service';
import { FinalizeRoundDto, PlaceStudentDto } from './dto/allocation.dto';

/**
 * The faculty office's desk, for one round.
 *
 * `@Roles('ADMIN')` sits on the class rather than on each handler on purpose:
 * every route below writes or reads group membership without any of the checks
 * that protect students from one another, and a route added later that forgot
 * the decorator would inherit the powers without the guard. There is nothing
 * here a lecturer or a student may do, not even the read — the list of students
 * who ended up with nothing is not a list anybody else should be browsing.
 */
@Roles('ADMIN')
@Controller('rounds/:roundId/allocation')
export class AllocationController {
  constructor(private readonly allocation: AllocationService) {}

  @Get()
  desk(@Param('roundId', ParseIntPipe) roundId: number) {
    return this.allocation.desk(roundId);
  }

  @Post('placements')
  place(
    @Param('roundId', ParseIntPipe) roundId: number,
    @Body() dto: PlaceStudentDto,
    @GetUser('id') userId: number,
  ) {
    return this.allocation.place(roundId, dto, userId);
  }

  @Delete('placements/:studentId')
  unplace(
    @Param('roundId', ParseIntPipe) roundId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @GetUser('id') userId: number,
  ) {
    return this.allocation.unplace(roundId, studentId, userId);
  }

  /**
   * Declared under the desk rather than beside `extend` on the rounds
   * controller, even though both move a round's phase. Finalising is the last
   * act of this screen and reads the same unplaced list the screen does —
   * putting it elsewhere would mean two places counting who was left out.
   */
  @Post('finalize')
  finalize(
    @Param('roundId', ParseIntPipe) roundId: number,
    @Body() dto: FinalizeRoundDto,
    @GetUser('id') userId: number,
  ) {
    return this.allocation.finalize(roundId, dto, userId);
  }
}
