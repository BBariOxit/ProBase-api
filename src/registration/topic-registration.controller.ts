import { Body, Controller, Param, ParseIntPipe, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { RegisterTopicDto } from './dto/register-topic.dto';
import { RegistrationGroupsService } from './registration-groups.service';

/**
 * The two ways into a group, both addressed by topic because that is what a
 * student is looking at when they decide.
 *
 * These share the `topics` prefix with TopicsController but live here, in the
 * module that owns registration: the topic is the noun in the URL, not the thing
 * being changed. Nest merges the routes, and neither of these collides with the
 * `GET :id` there.
 */
@Controller('topics')
export class TopicRegistrationController {
  constructor(private readonly groups: RegistrationGroupsService) {}

  /** Take an unclaimed topic. The caller becomes the group's leader. */
  @Roles('STUDENT')
  @Post(':id/register')
  register(
    @Param('id', ParseIntPipe) topicId: number,
    @Body() dto: RegisterTopicDto,
    @GetUser('id') userId: number,
  ) {
    return this.groups.register(topicId, dto, userId);
  }

  /** Join the group that already holds it, if it has a seat going spare. */
  @Roles('STUDENT')
  @Post(':id/join')
  join(
    @Param('id', ParseIntPipe) topicId: number,
    @GetUser('id') userId: number,
  ) {
    return this.groups.joinTopic(topicId, userId);
  }
}
