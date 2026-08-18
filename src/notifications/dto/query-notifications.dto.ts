import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const QueryNotificationsSchema = z.object({
  /**
   * A query string has no booleans, and `Boolean('false')` is true, so the value
   * is matched literally rather than coerced.
   */
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  // Capped so one request cannot ask for the whole inbox.
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export class QueryNotificationsDto extends createZodDto(
  QueryNotificationsSchema,
) {}
