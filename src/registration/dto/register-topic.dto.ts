import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * What a student may say when taking a topic.
 *
 * Everything else about the group — which topic, which semester, who leads it —
 * comes from the route and the access token, so none of it can be driven from
 * the body.
 */
export const RegisterTopicSchema = z.object({
  /**
   * How many the leader intends to bring, if they want seats held.
   *
   * Two is the floor because declaring one is the same as declaring nothing: no
   * seat would be held either way, and accepting the value invites a client to
   * send something that does nothing. The ceiling is checked against the topic's
   * own `maxStudents` in the service, which is the real limit.
   */
  declaredSize: z.coerce.number().int().min(2).max(10).optional(),
  name: z.string().trim().min(1).max(120).optional(),
});

export class RegisterTopicDto extends createZodDto(RegisterTopicSchema) {}
