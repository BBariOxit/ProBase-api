import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const QueryTopicLecturersSchema = z.object({
  // Optional so the caller can ask across every semester, but in practice the
  // client always narrows to the active one — a filter listing lecturers from
  // three years ago would be noise.
  semesterId: z.coerce.number().int().positive().optional(),
});

export class QueryTopicLecturersDto extends createZodDto(
  QueryTopicLecturersSchema,
) {}
