import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateSemesterSchema = z
  .object({
    name: z.string().min(1, 'Semester name is required').max(255),
    code: z
      .string()
      .min(1, 'Semester code is required')
      .max(50)
      .transform((val) => val.toUpperCase()),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    registrationStart: z.coerce.date(),
    registrationEnd: z.coerce.date(),
    gradeSubmissionDeadline: z.coerce.date().optional(),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: 'End date must be after start date',
    path: ['endDate'],
  })
  .refine((data) => data.registrationEnd > data.registrationStart, {
    message: 'Registration end must be after registration start',
    path: ['registrationEnd'],
  });

export class CreateSemesterDto extends createZodDto(CreateSemesterSchema) {}
