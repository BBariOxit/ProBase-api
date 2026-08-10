import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

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
  registrationStart: z.coerce.date().optional(),
  registrationEnd: z.coerce.date().optional(),
  gradeSubmissionDeadline: z.coerce.date().nullish(),
});

export class UpdateSemesterDto extends createZodDto(UpdateSemesterSchema) {}
