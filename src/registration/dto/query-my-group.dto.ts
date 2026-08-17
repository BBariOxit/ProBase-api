import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const QueryMyGroupSchema = z.object({
  /** Defaults to the active semester, which is what a student is asking about. */
  semesterId: z.coerce.number().int().positive().optional(),
});

export class QueryMyGroupDto extends createZodDto(QueryMyGroupSchema) {}
