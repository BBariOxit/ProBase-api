import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * What a student puts to a lecturer.
 *
 * Three things are deliberately not here. `semesterId` is the active one — a
 * proposal for a term the faculty is not currently running is not a thing anyone
 * wants to write. `maxStudents` belongs to the lecturer who will supervise it:
 * the student is offering an idea, and how many people it takes is a judgement
 * about the work, made by the person who has to guide it. And `status` moves
 * only through the service, never from a body.
 *
 * `requestedLecturerId` is required even though the column is nullable. A
 * proposal addressed to nobody is one nobody feels answerable for, and the
 * student is left waiting on a queue with no owner. The column stays nullable so
 * an open pool can be added later without a migration.
 */
export const CreateProposalSchema = z.object({
  projectTypeId: z.coerce.number().int().positive(),
  requestedLecturerId: z.coerce
    .number('Vui lòng chọn giảng viên bạn muốn gửi đề xuất')
    .int()
    .positive(),
  title: z.string().trim().min(1, 'Vui lòng nhập tên đề tài').max(255),
  description: z.string().trim().min(1, 'Vui lòng mô tả đề tài bạn muốn làm'),
  expectedOutcomes: z
    .string()
    .trim()
    .min(1, 'Vui lòng nêu bạn định làm ra được gì'),
});

export class CreateProposalDto extends createZodDto(CreateProposalSchema) {}
