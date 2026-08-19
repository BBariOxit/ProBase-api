import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Every filter the faculty office actually uses, and they compose.
 *
 * `roundId` rather than a project type id: a đợt is a semester crossed with a
 * kind of project, and which intakes it covers is declared on the round. Asking
 * by project type alone would mean guessing which term's version of it was
 * meant.
 *
 * `hasGroup` is a tri-state — set, unset, or absent — because "everyone",
 * "those who have a topic" and "those who do not" are three different questions
 * and the third one is the one the office opens this screen for.
 */
export const QueryStudentsSchema = z.object({
  semesterId: z.coerce.number().int().positive().optional(),
  roundId: z.coerce.number().int().positive().optional(),
  cohort: z
    .string()
    .trim()
    .regex(/^\d{4}$/, 'Khóa là năm nhập học gồm bốn chữ số')
    .optional(),
  majorId: z.coerce.number().int().positive().optional(),
  class: z.string().trim().min(1).max(100).optional(),
  lecturerId: z.coerce.number().int().positive().optional(),
  hasGroup: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  q: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export class QueryStudentsDto extends createZodDto(QueryStudentsSchema) {}
