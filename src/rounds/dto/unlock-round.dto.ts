import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Reopening the allocation of a round that has already been settled.
 *
 * The reason is the whole of this payload, and it is required for the same
 * cause as an extension's: finalising told every student in the round what they
 * would be working on, and undoing that quietly leaves the faculty with nothing
 * to say when one of them asks why their topic changed. It goes to
 * `audit_logs`.
 */
export const UnlockRoundSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'Vui lòng nhập lý do mở khoá')
    .max(500, 'Lý do mở khoá tối đa 500 ký tự'),
});

export class UnlockRoundDto extends createZodDto(UnlockRoundSchema) {}
