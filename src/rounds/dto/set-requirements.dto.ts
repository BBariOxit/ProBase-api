import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * What a round requires its groups to hand in, sent as the whole list.
 *
 * Declarative for the same reason the semester's registration plan is: the
 * office thinks in terms of "this is what Tốt nghiệp hands in this term", not
 * in terms of three separate edits. Sending the whole list also means the
 * service works out what that implies — which rows are new, which changed,
 * which the office has taken off — instead of the screen having to diff its own
 * intent against what is already stored, which is the step it would get wrong.
 *
 * The order of the array is the order the office meant, and becomes the order
 * every screen shows. It is not derived from the dates: two documents sharing a
 * deadline still have an order.
 */
export const RequirementSchema = z.object({
  /**
   * Present for a row that already exists, absent for a new one. Identity by id
   * rather than by name, so renaming "Báo cáo" to "Quyển báo cáo" is a rename
   * and not a delete plus an insert — the second of which would refuse, because
   * work has been handed in against the old row.
   */
  id: z.coerce.number().int().positive().optional(),
  name: z
    .string()
    .trim()
    .min(1, 'Tên tài liệu không được để trống')
    .max(100, 'Tên tài liệu tối đa 100 ký tự'),
  dueAt: z.coerce.date(),
  /**
   * Optional items are still reminded about; they just do not count towards a
   * group having handed in everything.
   */
  isRequired: z.boolean().default(true),
});

export const SetRequirementsSchema = z
  .object({
    // Ten is not a business rule, it is a guard against a paste. A faculty
    // asking for more than ten separate documents from one project has a
    // process problem this screen cannot fix.
    requirements: z.array(RequirementSchema).max(10),
  })
  .refine(
    (body) =>
      new Set(body.requirements.map((one) => one.name.trim().toLowerCase()))
        .size === body.requirements.length,
    {
      message: 'Hai tài liệu trùng tên — sinh viên sẽ không biết chọn cái nào',
      path: ['requirements'],
    },
  );

export class SetRequirementsDto extends createZodDto(SetRequirementsSchema) {}
