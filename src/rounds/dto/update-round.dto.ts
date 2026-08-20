import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { AllocationMode } from '../../../generated/prisma/client';
import { CohortSchema } from './set-semester-rounds.dto';

/**
 * Adjusting one round without resending the semester's whole plan.
 *
 * `projectTypeId` is absent on purpose: it is half of what identifies the round,
 * and topics already point here. Moving a round to another kind of project would
 * silently reclassify every topic in it.
 *
 * The two dates can only be moved while the gate is still shut or still open —
 * see RoundsService. Past that, moving the closing date is not an edit to the
 * schedule but a reopening, and it goes through Gia hạn so that it acquires a
 * reason and an author.
 */
export const UpdateRoundSchema = z.object({
  registrationStart: z.coerce.date().optional(),
  registrationEnd: z.coerce.date().optional(),
  cohorts: z.array(CohortSchema).min(1).max(20).optional(),
  allocationMode: z.enum(AllocationMode).optional(),
  /**
   * The report deadlines, where absent means "leave it" and null means "take it
   * back" — unlike the whole-semester plan, in which an omission is a removal.
   * A partial edit cannot tell the two apart any other way.
   *
   * Unlike the registration window, these stay editable in every phase. Moving
   * them is not reopening anything: the gate is a race between students and
   * changing it retroactively decides who won, while a report deadline only ever
   * says when work is expected, and a faculty that grants an extra week should
   * not have to invent a second mechanism to say so.
   */
  midtermDueAt: z.coerce.date().nullish(),
  finalDueAt: z.coerce.date().nullish(),
});

export class UpdateRoundDto extends createZodDto(UpdateRoundSchema) {}
