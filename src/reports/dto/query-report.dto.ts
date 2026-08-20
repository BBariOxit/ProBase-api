import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Which term to report on.
 *
 * Optional, and absent means the one the faculty currently has open — the
 * question is almost always about now, and making the screen name a semester
 * before it can show anything would be a step with one sensible answer.
 */
export const QueryReportSchema = z.object({
  semesterId: z.coerce.number().int().positive().optional(),
});

export class QueryReportDto extends createZodDto(QueryReportSchema) {}
