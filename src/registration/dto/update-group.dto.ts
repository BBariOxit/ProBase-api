import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * The leader's controls over their own group.
 *
 * `holdUntil` is not among them. It is fixed when the group is created and can
 * only be brought forward, never pushed out: letting a leader extend it would
 * turn a 24-hour courtesy into an indefinite lock on a topic, which is the one
 * thing the deadline exists to prevent.
 *
 * `declaredSize` is editable inside that fixed window, which is a different
 * thing. It says how many of the topic's seats the group is claiming, and moving
 * it does not move the deadline — so a leader who first said three and then
 * agrees to go with two frees the third seat immediately, and one whose third
 * friend turns up can claim it back for whatever is left of the window they were
 * already granted. Once the window lapses the number stops mattering entirely.
 */
export const UpdateGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(120).nullable().optional(),
    openForJoin: z.boolean().optional(),
    /**
     * How many of the topic's seats this group is claiming. Bounded by the
     * members already in it and by the topic's capacity, both checked in the
     * service where those numbers are known. Null gives up the claim entirely.
     *
     * Two is the floor, matching RegisterTopicSchema: claiming one seat holds
     * nothing — the leader is already sitting in it — so the value is exactly
     * equivalent to null while looking like a decision. Accepting it here and
     * refusing it there let the same field mean two different things depending
     * on which endpoint you reached it through.
     */
    declaredSize: z.coerce.number().int().min(2).max(10).nullable().optional(),
    /** Give the held seats up now, whatever the declared size says. */
    releaseHold: z.literal(true).optional(),
    /** Hand the group over. Must be a student profile already in the group. */
    leaderId: z.coerce.number().int().positive().optional(),
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    {
      message: 'Không có thay đổi nào để lưu',
    },
  );

export class UpdateGroupDto extends createZodDto(UpdateGroupSchema) {}
