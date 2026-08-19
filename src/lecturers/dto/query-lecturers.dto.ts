import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * The directory is browsed by somebody looking for a supervisor, so the only
 * filter is the one they would actually use: a name, or the code on their
 * timetable. Anything narrower — by title, by research area — would be a menu of
 * choices most of which lead nowhere in a faculty of forty.
 */
export const QueryLecturersSchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export class QueryLecturersDto extends createZodDto(QueryLecturersSchema) {}
