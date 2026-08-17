import { z } from 'zod';
import { Role } from '../../../generated/prisma/client';
import { emailSchema } from '../../common/email.schema';
import { checkClassCode } from '../class-code.util';
import {
  cohortFromStudentCode,
  studentCodeMatchesEmail,
} from '../student-code.util';

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

// `cohort` is absent from the input and added by the transform below: it is
// read out of the student code, which is the same string as the email's local
// part. Accepting it as a field would mean accepting a value that can
// contradict the two others.
const StudentCreateSchema = z
  .object({
    role: z.literal(Role.STUDENT),
    email: emailSchema,
    studentCode: trimmed(50).pipe(
      z
        .string()
        .regex(
          /^\d{7}$/,
          'Student code must be 7 digits: 2 for the intake year, 5 for the sequence',
        ),
    ),
    fullName: requiredTrimmed(255, 'Full name is required'),
    majorId: z.number().int().positive().optional(),
    class: trimmed(100).optional(),
    phone: trimmed(20).optional(),
    bio: trimmed(2000).optional(),
  })
  .refine((input) => studentCodeMatchesEmail(input.studentCode, input.email), {
    path: ['email'],
    message: 'Email must start with the student code (e.g. 2212345@dlu.edu.vn)',
  })
  // A class code carries the intake too (`CTK46PM`), so it is a third claim
  // about the same fact and gets checked against the code like the email does.
  // An unrecognised shape is accepted — the faculty runs classes this pattern
  // does not cover — but a contradiction means one of the two is a typo.
  .refine(
    (input) =>
      checkClassCode(input.class, input.studentCode).status !== 'contradiction',
    {
      path: ['class'],
      message:
        'Class code and student code disagree about the intake year — fix whichever is wrong',
    },
  )
  .transform((input) => ({
    ...input,
    // Non-null by construction — the regex above has already checked the shape.
    cohort: cohortFromStudentCode(input.studentCode)!,
  }));

const LecturerCreateSchema = z.object({
  role: z.literal(Role.LECTURER),
  email: emailSchema,
  lecturerCode: requiredTrimmed(50, 'Lecturer code is required'),
  fullName: requiredTrimmed(255, 'Full name is required'),
  academicTitle: trimmed(100).optional(),
  researchInterests: trimmed(1000).optional(),
  phone: trimmed(20).optional(),
  bio: trimmed(2000).optional(),
});

const AdminCreateSchema = z.object({
  role: z.literal(Role.ADMIN),
  email: emailSchema,
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
