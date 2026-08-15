import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpsertLecturerProfileSchema = z.object({
  lecturerCode: z
    .string()
    .min(1, 'Lecturer code is required')
    .max(50)
    .transform((val) => val.trim()),
  fullName: z
    .string()
    .min(1, 'Full name is required')
    .max(255)
    .transform((val) => val.trim()),
  academicTitle: z.string().max(100).optional().nullable(), // e.g. "TS.", "PGS.TS.", "GS.TS."
  phone: z.string().max(20).optional().nullable(),
  bio: z.string().max(2000).optional().nullable(),
  researchInterests: z.string().max(1000).optional().nullable(),
  maxMentoringQuota: z.number().int().positive().optional().nullable(), // null = no limit
});

export class UpsertLecturerProfileDto extends createZodDto(
  UpsertLecturerProfileSchema,
) {}
