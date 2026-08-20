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
});

export class UpdateRoundDto extends createZodDto(UpdateRoundSchema) {}
