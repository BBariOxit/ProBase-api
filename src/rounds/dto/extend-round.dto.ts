import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Reopening a round that has already closed.
 *
 * Both fields are required, and the reason is the more important of the two. An
 * extension overrides a deadline the faculty announced, and the only record of
 * why it was overridden is what the person pressing the button typed here — it
 * goes to `audit_logs` alongside the old and new deadline.
 */
export const ExtendRoundSchema = z.object({
  registrationEnd: z.coerce.date(),
  reason: z
    .string()
    .trim()
    .min(1, 'Vui lòng nhập lý do gia hạn')
    .max(500, 'Lý do gia hạn tối đa 500 ký tự'),
});

export class ExtendRoundDto extends createZodDto(ExtendRoundSchema) {}
