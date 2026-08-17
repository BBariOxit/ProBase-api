import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * The leader's controls over their own group.
 *
 * `declaredSize` and `holdUntil` are not editable. The hold exists so a leader
 * can gather the friends they already agreed with, and letting it be pushed
 * outwards would turn a 24-hour courtesy into an indefinite lock on a topic —
 * which is the one thing the deadline is there to prevent. Releasing early is
 * always allowed, so the only move on offer is the one that frees a seat.
 */
export const UpdateGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(120).nullable().optional(),
    openForJoin: z.boolean().optional(),
    /**
     * Give the held seats up now. `true` only — there is no way back, because
     * re-holding is extending the hold under another name.
     */
    releaseHold: z.literal(true).optional(),
    /** Hand the group over. Must be a student profile already in the group. */
    leaderId: z.coerce.number().int().positive().optional(),
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    {
      message: 'Nothing to update',
    },
  );

export class UpdateGroupDto extends createZodDto(UpdateGroupSchema) {}
