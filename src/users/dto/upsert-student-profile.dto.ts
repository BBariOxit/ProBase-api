import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { cohortFromStudentCode } from '../student-code.util';

/**
 * `cohort` is not an input here either. It is read out of the student code, so
 * that the one place a student's intake year comes from is the code itself —
 * an editable cohort field would let an admin correct a symptom while leaving
 * the code that produced it, and the two would disagree from then on.
 *
 * The email is not part of this payload (it lives on the User row), so the
 * code/email agreement is checked where accounts are created rather than here.
 */
export const UpsertStudentProfileSchema = z
  .object({
    studentCode: z
      .string()
      .transform((val) => val.trim())
      .pipe(
        z
          .string()
          .regex(
            /^\d{7}$/,
            'Student code must be 7 digits: 2 for the intake year, 5 for the sequence',
          ),
      ),
    fullName: z
      .string()
      .min(1, 'Full name is required')
      .max(255)
      .transform((val) => val.trim()),
    majorId: z.number().int().positive().optional().nullable(),
    class: z.string().max(100).optional().nullable(),
    phone: z.string().max(20).optional().nullable(),
    bio: z.string().max(2000).optional().nullable(),
  })
  .transform((input) => ({
    ...input,
    // Non-null by construction — the regex above has already checked the shape.
    cohort: cohortFromStudentCode(input.studentCode)!,
  }));

export class UpsertStudentProfileDto extends createZodDto(
  UpsertStudentProfileSchema,
) {}
