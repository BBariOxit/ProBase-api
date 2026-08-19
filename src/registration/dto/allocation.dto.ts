import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * One student, one topic. Nothing else, and in particular no group id: which
 * group a placed student lands in is a consequence of the topic — the one that
 * already holds it, or a new one — and letting the caller name it would be
 * letting them put somebody in a group that is not on the topic they chose.
 */
export const PlaceStudentSchema = z.object({
  studentId: z.coerce.number('Vui lòng chọn sinh viên').int().positive(),
  topicId: z.coerce.number('Vui lòng chọn đề tài').int().positive(),
});

export class PlaceStudentDto extends createZodDto(PlaceStudentSchema) {}

/**
 * Closing the round, and the escape hatch for the students it could not place.
 *
 * Finalising with people still unplaced is refused by default, because in the
 * ordinary case it means somebody stopped halfway and the round would be sealed
 * with students left out of it. But there is always a handful the office cannot
 * place and should not have to: deferred, on leave, gone. Refusing outright would
 * leave the round stuck open forever, so the exception exists — and it costs a
 * sentence, recorded in the audit log, because a decision that leaves students
 * without a project is one somebody will be asked about.
 */
export const FinalizeRoundSchema = z
  .object({
    acknowledgeUnplaced: z.coerce.boolean().default(false),
    reason: z.string().trim().max(500).optional(),
  })
  .refine(
    (input) => !input.acknowledgeUnplaced || (input.reason?.length ?? 0) > 0,
    {
      path: ['reason'],
      message:
        'Vui lòng ghi lý do chốt đợt khi vẫn còn sinh viên chưa được xếp',
    },
  );

export class FinalizeRoundDto extends createZodDto(FinalizeRoundSchema) {}
