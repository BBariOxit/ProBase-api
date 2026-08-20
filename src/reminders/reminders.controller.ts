import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { RemindersService } from './reminders.service';

/**
 * One door, and it exists so the office is never left waiting for 07:00.
 *
 * Two moments call for it: an evening when the server was down and the morning
 * pass never ran, and the afternoon a deadline is first announced — the students
 * it concerns should not wait a night to hear about it.
 *
 * Admin only, though the reason is not that a pass is dangerous. Running it
 * twice sends nothing the second time, which is the property the whole job is
 * built on. It is that this writes to other people's inboxes, and deciding when
 * the faculty speaks to a whole intake is the office's call.
 */
@Roles('ADMIN')
@Controller('reminders')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  run() {
    return this.reminders.run();
  }
}
