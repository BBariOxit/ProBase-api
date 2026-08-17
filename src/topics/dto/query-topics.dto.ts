import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { TopicStatus } from '../../../generated/prisma/client';

export const QueryTopicsSchema = z.object({
  semesterId: z.coerce.number().int().positive().optional(),
  projectTypeId: z.coerce.number().int().positive().optional(),
  lecturerId: z.coerce.number().int().positive().optional(),
  // Students never widen their own visibility with this — TopicsService
  // intersects whatever is asked for with the statuses their role may see.
  status: z.enum(TopicStatus).optional(),
  q: z.string().trim().min(1).max(255).optional(),
  // A query string has no booleans, and Boolean('false') is true, so the value
  // is matched literally rather than coerced.
  mine: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  /**
   * Narrow to the kinds of project the caller's own intake may take.
   *
   * A boolean rather than a list of project-type ids, because the mapping from
   * intake to project type is a faculty rule the API already holds — asking the
   * client to send the answer would mean trusting it to have looked the rule up
   * correctly, and a stale tab would then quietly widen the list.
   */
  forMyCohort: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  // Capped so one request cannot ask for the entire table.
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export class QueryTopicsDto extends createZodDto(QueryTopicsSchema) {}
