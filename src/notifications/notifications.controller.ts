import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { NotificationsService } from './notifications.service';

/**
 * Every route here is about the caller and only the caller. There is no id in
 * any path that selects *whose* notices are read, and no admin view: an inbox is
 * the one place in this system where "see everything" has no legitimate use.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findMine(
    @Query() query: QueryNotificationsDto,
    @GetUser('id') userId: number,
  ) {
    return this.notificationsService.findMine(query, userId);
  }

  @Patch(':id/read')
  markRead(
    @Param('id', ParseIntPipe) id: number,
    @GetUser('id') userId: number,
  ) {
    return this.notificationsService.markRead(id, userId);
  }

  @Post('read-all')
  markAllRead(@GetUser('id') userId: number) {
    return this.notificationsService.markAllRead(userId);
  }
}
