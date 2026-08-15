import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * What a lecturer may set when opening a topic.
 *
 * `lecturerId` and `status` are absent on purpose. The owner is taken from the
 * access token and the status only ever moves through the transitions in
 * TopicsService, so neither can be driven from the request body.
 */
export const CreateTopicSchema = z.object({
  semesterId: z.coerce.number().int().positive(),
  projectTypeId: z.coerce.number().int().positive(),
  title: z.string().trim().min(1, 'Topic title is required').max(255),
  description: z.string().trim().min(1, 'Description is required'),
  expectedOutcomes: z.string().trim().min(1, 'Expected outcomes are required'),
  // Capped so a typo cannot turn one topic into a whole cohort.
  maxStudents: z.coerce.number().int().min(1).max(10).default(1),
});

export class CreateTopicDto extends createZodDto(CreateTopicSchema) {}
