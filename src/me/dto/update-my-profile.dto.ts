import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * The few things a person may say about themselves.
 *
 * Everything absent from this list is absent on purpose. A student's name, code,
 * class, cohort and major arrive from the faculty office's import and the system
 * reasons with them — cohort decides which kind of project an intake may take,
 * and the class code is cross-checked against the student code — so a
 * self-service edit would not be a correction, it would be a way to walk into a
 * round you are not in. The office owns those; `PUT /users/:id/student-profile`
 * is where they change.
 *
 * `academicTitle` is here and `maxMentoringQuota` is not, and the line between
 * them is the same line: a title is a fact about the person, which they are the
 * first to know when it changes, while the mentoring quota is the faculty's
 * policy about how much work they may be given. Letting a lecturer raise their
 * own quota is letting them assign themselves more students.
 *
 * Empty strings are folded to null so that clearing a field in a form does not
 * store `""` next to the nulls that mean the same thing.
 */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.trim())
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

export const UpdateMyProfileSchema = z
  .object({
    /** Both roles. */
    phone: optionalText(20),
    bio: optionalText(2000),
    /** Lecturers only; refused for a student, rather than quietly dropped. */
    academicTitle: optionalText(100),
    researchInterests: optionalText(1000),
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    {
      message: 'Không có thay đổi nào để lưu',
    },
  );

export class UpdateMyProfileDto extends createZodDto(UpdateMyProfileSchema) {}

/** Fields only a lecturer may send, named once so the service can say which. */
export const LECTURER_ONLY_FIELDS = [
  'academicTitle',
  'researchInterests',
] as const;
