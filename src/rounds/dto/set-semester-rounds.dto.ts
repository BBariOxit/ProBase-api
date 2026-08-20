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

/** As much of a round as checking its two report deadlines needs. */
export interface DeadlinePlan {
  registrationEnd?: Date | null;
  midtermDueAt?: Date | null;
  finalDueAt?: Date | null;
}

/**
 * The two report deadlines, in the only order they can happen in.
 *
 * A report cannot fall due before the group that writes it exists, and the
 * final one cannot precede the midterm. Both are typos rather than decisions —
 * a year mistyped, or the two fields filled in the wrong boxes — and catching
 * them here is the difference between a refusal the office can read and a
 * reminder that goes out to a whole intake about a date in the past.
 *
 * Shared with the single-round edit, which checks the same rules against
 * whatever it is not changing.
 */
export function deadlineProblems(
  plan: DeadlinePlan,
): { path: 'midtermDueAt' | 'finalDueAt'; message: string }[] {
  const { registrationEnd, midtermDueAt, finalDueAt } = plan;
  const problems: ReturnType<typeof deadlineProblems> = [];

  for (const [path, due] of [
    ['midtermDueAt', midtermDueAt],
    ['finalDueAt', finalDueAt],
  ] as const) {
    if (due && registrationEnd && due <= registrationEnd) {
      problems.push({
        path,
        message: 'Hạn nộp báo cáo phải sau ngày đóng đăng ký',
      });
    }
  }

  if (midtermDueAt && finalDueAt && finalDueAt <= midtermDueAt) {
    problems.push({
      path: 'finalDueAt',
      message: 'Hạn nộp báo cáo cuối kỳ phải sau hạn nộp giữa kỳ',
    });
  }

  return problems;
}

/** The same rules, as a Zod refinement for the payloads that carry every field. */
export function assertDeadlinesMakeSense(
  plan: DeadlinePlan,
  ctx: z.RefinementCtx,
): void {
  for (const problem of deadlineProblems(plan)) {
    ctx.addIssue({
      code: 'custom',
      message: problem.message,
      path: [problem.path],
    });
  }
}

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
    /**
     * When each report is due. Both optional, and omitting one clears it —
     * this payload replaces the term's whole arrangement, so a date left out is
     * a date the office has taken back rather than one they forgot to resend.
     *
     * Source code has no date of its own: it is due with the final report,
     * because a fourth field is a fourth thing to keep in step by hand.
     */
    midtermDueAt: z.coerce.date().nullish(),
    finalDueAt: z.coerce.date().nullish(),
  })
  .refine((plan) => plan.registrationEnd > plan.registrationStart, {
    message: 'Ngày kết thúc đăng ký phải sau ngày mở đăng ký',
    path: ['registrationEnd'],
  })
  .superRefine(assertDeadlinesMakeSense);

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
