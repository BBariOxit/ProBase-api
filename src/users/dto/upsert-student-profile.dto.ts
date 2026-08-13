import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpsertStudentProfileSchema = z.object({
  studentCode: z
    .string()
    .min(1, 'Student code is required')
    .max(50)
    .transform((val) => val.trim()),
  fullName: z
    .string()
    .min(1, 'Full name is required')
    .max(255)
    .transform((val) => val.trim()),
  majorId: z.number().int().positive().optional().nullable(),
  class: z.string().max(100).optional().nullable(),
  cohort: z.string().max(10).optional().nullable(), // e.g. "2021"
  phone: z.string().max(20).optional().nullable(),
  bio: z.string().max(2000).optional().nullable(),
});

export class UpsertStudentProfileDto extends createZodDto(
  UpsertStudentProfileSchema,
) {}
