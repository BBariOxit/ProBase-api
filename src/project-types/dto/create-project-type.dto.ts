import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateProjectTypeSchema = z.object({
  name: z.string().min(1, 'Project type name is required').max(255),
  code: z
    .string()
    .min(1, 'Project type code is required')
    .max(50)
    .transform((val) => val.toUpperCase()),
});

export class CreateProjectTypeDto extends createZodDto(
  CreateProjectTypeSchema,
) {}
