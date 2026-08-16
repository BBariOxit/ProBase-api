import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * The whole mapping for a semester, sent at once and replacing what was there.
 *
 * A declarative set rather than add/remove endpoints, because that is how the
 * office thinks about it: one announcement saying which cohort does which kind
 * of project this semester. Editing it row by row would leave the caller
 * responsible for diffing their intent against the current state, which is
 * exactly the step they would get wrong.
 */
export const SetEligibilitySchema = z.object({
  entries: z
    .array(
      z.object({
        projectTypeId: z.coerce.number().int().positive(),
        // Year of admission, matching StudentProfile.cohort — "2022", not
        // "K46". The K-number is display only and its offset is per-university.
        cohort: z
          .string()
          .trim()
          .regex(/^\d{4}$/, 'cohort must be the four-digit intake year'),
      }),
    )
    .max(100),
});

export class SetEligibilityDto extends createZodDto(SetEligibilitySchema) {}
