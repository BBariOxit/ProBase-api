import { z } from 'zod';
import { emailSchema } from '../../common/email.schema';

// Expected spreadsheet columns (header names, case-insensitive):
// email, role, fullName, code, majorCode (STUDENT), departmentCode (LECTURER),
// class, cohort (STUDENT-only, optional), academicTitle, researchInterests
// (LECTURER-only, optional), phone, bio (optional, both roles).

const StudentImportRowSchema = z.object({
  role: z.literal('STUDENT'),
  email: emailSchema,
  fullName: z.string().min(1, 'fullName is required').max(255),
  code: z.string().min(1, 'code is required').max(50),
  majorCode: z
    .string()
    .min(1, 'majorCode is required for STUDENT rows')
    .max(50),
  class: z.string().max(100).optional(),
  cohort: z.string().max(10).optional(),
  phone: z.string().max(20).optional(),
  bio: z.string().max(2000).optional(),
});

const LecturerImportRowSchema = z.object({
  role: z.literal('LECTURER'),
  email: emailSchema,
  fullName: z.string().min(1, 'fullName is required').max(255),
  code: z.string().min(1, 'code is required').max(50),
  departmentCode: z
    .string()
    .min(1, 'departmentCode is required for LECTURER rows')
    .max(50),
  academicTitle: z.string().max(100).optional(),
  researchInterests: z.string().max(1000).optional(),
  phone: z.string().max(20).optional(),
  bio: z.string().max(2000).optional(),
});

export const ImportRowSchema = z.discriminatedUnion('role', [
  StudentImportRowSchema,
  LecturerImportRowSchema,
]);

export type StudentImportRow = z.infer<typeof StudentImportRowSchema>;
export type LecturerImportRow = z.infer<typeof LecturerImportRowSchema>;
export type ImportRow = z.infer<typeof ImportRowSchema>;

const asOptional = (value: string | undefined) =>
  value && value.length > 0 ? value : undefined;

/** Maps a raw {lowercased header -> text} row into the shape ImportRowSchema expects. */
export function toImportRowInput(raw: Record<string, string>): unknown {
  return {
    role: asOptional(raw.role)?.toUpperCase(),
    email: asOptional(raw.email),
    fullName: asOptional(raw.fullname),
    code: asOptional(raw.code),
    majorCode: asOptional(raw.majorcode),
    departmentCode: asOptional(raw.departmentcode),
    class: asOptional(raw.class),
    cohort: asOptional(raw.cohort),
    academicTitle: asOptional(raw.academictitle),
    researchInterests: asOptional(raw.researchinterests),
    phone: asOptional(raw.phone),
    bio: asOptional(raw.bio),
  };
}

export function formatImportRowError(error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length
        ? `${issue.path.join('.')}: ${issue.message}`
        : issue.message,
    )
    .join('; ');
}
