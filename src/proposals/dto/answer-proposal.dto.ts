import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Accepting is not a button, it is a small decision.
 *
 * The one thing the lecturer has to supply is how many students the topic
 * holds, because that is the field the proposal deliberately does not carry —
 * and it is the field a group's whole seat arithmetic is built on, so it cannot
 * be defaulted to something plausible and corrected later.
 */
export const AcceptProposalSchema = z.object({
  // The same ceiling as a lecturer's own topic, so the two paths cannot produce
  // topics the rest of the system treats differently.
  maxStudents: z.coerce
    .number('Vui lòng nhập số sinh viên tối đa')
    .int()
    .min(1)
    .max(10),
});

export class AcceptProposalDto extends createZodDto(AcceptProposalSchema) {}

/**
 * Rejecting requires a reason, and this is the whole schema for that.
 *
 * A bare "no" is the fastest way to teach a student nothing and receive the same
 * proposal again next week. It also costs the lecturer very little: the sentence
 * they would have said out loud is the sentence that goes here.
 */
export const RejectProposalSchema = z.object({
  feedback: z
    .string('Vui lòng cho sinh viên biết vì sao đề xuất chưa được nhận')
    .trim()
    .min(1, 'Vui lòng cho sinh viên biết vì sao đề xuất chưa được nhận')
    .max(2000),
});

export class RejectProposalDto extends createZodDto(RejectProposalSchema) {}
