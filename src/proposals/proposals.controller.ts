import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { Role } from '../../generated/prisma/client';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  AcceptProposalDto,
  RejectProposalDto,
} from './dto/answer-proposal.dto';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { QueryProposalsDto } from './dto/query-proposals.dto';
import { UpdateProposalDto } from './dto/update-proposal.dto';
import { ProposalsService } from './proposals.service';

/**
 * A student's idea, and a lecturer's answer to it.
 *
 * Both sides read `GET /proposals`: the token decides which end of the exchange
 * you are standing at, so there is no id in the query for anyone to swap. The
 * two answering routes are `@Roles('LECTURER')` because they are the only ones
 * where the role, rather than ownership, is the thing being checked.
 */
@Controller('proposals')
export class ProposalsController {
  constructor(private readonly proposalsService: ProposalsService) {}

  @Roles('STUDENT')
  @Post()
  create(@Body() dto: CreateProposalDto, @GetUser('id') userId: number) {
    return this.proposalsService.create(dto, userId);
  }

  @Get()
  findAll(
    @Query() query: QueryProposalsDto,
    @GetUser('id') userId: number,
    @GetUser('role') role: Role,
  ) {
    return this.proposalsService.findAll(query, userId, role);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @GetUser('id') userId: number,
    @GetUser('role') role: Role,
  ) {
    return this.proposalsService.findOne(id, userId, role);
  }

  @Roles('STUDENT')
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProposalDto,
    @GetUser('id') userId: number,
  ) {
    return this.proposalsService.update(id, dto, userId);
  }

  @Roles('STUDENT')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @GetUser('id') userId: number) {
    return this.proposalsService.remove(id, userId);
  }

  @Roles('LECTURER')
  @Post(':id/accept')
  accept(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AcceptProposalDto,
    @GetUser('id') userId: number,
  ) {
    return this.proposalsService.accept(id, dto, userId);
  }

  @Roles('LECTURER')
  @Post(':id/reject')
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectProposalDto,
    @GetUser('id') userId: number,
  ) {
    return this.proposalsService.reject(id, dto, userId);
  }
}
