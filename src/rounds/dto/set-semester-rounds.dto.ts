import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { AllocationMode } from '../../../generated/prisma/client';

/**
 * Year of admission, matching StudentProfile.cohort — `"2022"`, not `"K46"`.
 * The K-number is display only and its offset differs between universities.
 */
export const CohortSchema = z
  .string()
  .trim()
  .regex(/^\d{4}$/, 'Khóa phải là năm nhập học gồm bốn chữ số');

export const RoundPlanSchema = z
  .object({
    projectTypeId: z.coerce.number().int().positive(),
    registrationStart: z.coerce.date(),
    registrationEnd: z.coerce.date(),
    /**
     * Which intakes this round is for. At least one, because a round no intake
     * may register in is a gate with nobody behind it — better refused at the
     * point of typing than discovered by a student whose only symptom is an
     * empty list.
     */
    cohorts: z.array(CohortSchema).min(1).max(20),
    allocationMode: z.enum(AllocationMode).optional(),
  })
  .refine((plan) => plan.registrationEnd > plan.registrationStart, {
    message: 'Ngày kết thúc đăng ký phải sau ngày mở đăng ký',
    path: ['registrationEnd'],
  });

/**
 * The whole registration plan for a semester, sent at once.
 *
 * Declarative rather than one endpoint per round, because that is how the
 * office thinks about it: one announcement saying which intake does which kind
 * of project this term, and from when to when. Editing round by round would
 * leave the caller responsible for diffing their intent against the current
 * state, which is exactly the step they would get wrong.
 *
 * Rounds already carrying topics are never removed by an omission — the service
 * refuses instead of quietly dropping work a lecturer has done.
 */
export const SetSemesterRoundsSchema = z
  .object({ rounds: z.array(RoundPlanSchema).min(1).max(20) })
  .refine(
    (body) =>
      new Set(body.rounds.map((round) => round.projectTypeId)).size ===
      body.rounds.length,
    {
      message: 'Mỗi loại đồ án chỉ được khai một đợt trong học kỳ',
      path: ['rounds'],
    },
  );

export class SetSemesterRoundsDto extends createZodDto(
  SetSemesterRoundsSchema,
) {}
