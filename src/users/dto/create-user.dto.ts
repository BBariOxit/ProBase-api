import { z } from 'zod';
import { Role } from '../../../generated/prisma/client';

// A STUDENT/LECTURER account is meaningless without its profile — every
// downstream relation (groups, grades, topics) points at the profile, not the
// User — so the profile is created alongside the account, not bolted on after.
// ADMIN has no profile table, so it only needs an email.

const trimmed = (max: number) =>
  z
    .string()
    .max(max)
    .transform((val) => val.trim());

const requiredTrimmed = (max: number, message: string) =>
  trimmed(max).pipe(z.string().min(1, message));

const StudentCreateSchema = z.object({
  role: z.literal(Role.STUDENT),
  email: z.string().email('Invalid email address'),
  studentCode: requiredTrimmed(50, 'Student code is required'),
  fullName: requiredTrimmed(255, 'Full name is required'),
  majorId: z.number().int().positive().optional(),
  class: trimmed(100).optional(),
  cohort: trimmed(10).optional(),
  phone: trimmed(20).optional(),
  bio: trimmed(2000).optional(),
});

const LecturerCreateSchema = z.object({
  role: z.literal(Role.LECTURER),
  email: z.string().email('Invalid email address'),
  lecturerCode: requiredTrimmed(50, 'Lecturer code is required'),
  fullName: requiredTrimmed(255, 'Full name is required'),
  departmentId: z.number().int().positive().optional(),
  academicTitle: trimmed(100).optional(),
  researchInterests: trimmed(1000).optional(),
  phone: trimmed(20).optional(),
  bio: trimmed(2000).optional(),
});

const AdminCreateSchema = z.object({
  role: z.literal(Role.ADMIN),
  email: z.string().email('Invalid email address'),
});

export const CreateUserSchema = z.discriminatedUnion('role', [
  StudentCreateSchema,
  LecturerCreateSchema,
  AdminCreateSchema,
]);

// A union can't back a createZodDto class (a class cannot extend a union), so
// the controller applies ZodValidationPipe with this schema directly — which
// keeps role-based narrowing intact in the service.
export type CreateUserDto = z.infer<typeof CreateUserSchema>;
