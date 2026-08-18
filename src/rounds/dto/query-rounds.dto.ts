import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const QueryRoundsSchema = z.object({
  semesterId: z.coerce.number().int().positive().optional(),
  projectTypeId: z.coerce.number().int().positive().optional(),
  /**
   * Only the rounds this caller's intake may take part in.
   *
   * A query string has no booleans, and `Boolean('false')` is true, so the value
   * is matched literally rather than coerced.
   */
  mine: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export class QueryRoundsDto extends createZodDto(QueryRoundsSchema) {}
