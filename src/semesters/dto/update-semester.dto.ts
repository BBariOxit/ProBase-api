import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Every field optional, so no cross-field rule can live here: a refinement only
 * sees what was sent, and a PATCH moving one date has nothing to compare it
 * with. `endDate > startDate` is therefore checked in SemestersService against
 * the merged row — which is the only place both values exist.
 *
 * The registration window is not here at all; it belongs to a round. Moving a
 * round's closing date after its gate has shut is a reopening rather than an
 * edit, and goes through `POST /rounds/:id/extend`.
 */
export const UpdateSemesterSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  code: z
    .string()
    .min(1)
    .max(50)
    .transform((val) => val.toUpperCase())
    .optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  gradeSubmissionDeadline: z.coerce.date().nullish(),
});

export class UpdateSemesterDto extends createZodDto(UpdateSemesterSchema) {}
