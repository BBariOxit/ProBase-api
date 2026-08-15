import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * `semesterId` is missing on purpose. RegistrationGroup carries a denormalised
 * semesterId that a composite foreign key pins to the topic's own, so moving a
 * topic between semesters would have to drag every group with it — that is a
 * migration, not an edit.
 */
export const UpdateTopicSchema = z.object({
  projectTypeId: z.coerce.number().int().positive().optional(),
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().min(1).optional(),
  expectedOutcomes: z.string().trim().min(1).optional(),
  maxStudents: z.coerce.number().int().min(1).max(10).optional(),
});

export class UpdateTopicDto extends createZodDto(UpdateTopicSchema) {}
