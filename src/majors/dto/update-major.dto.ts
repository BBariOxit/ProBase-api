import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const UpdateMajorSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  code: z
    .string()
    .min(1)
    .max(50)
    .transform((val) => val.toUpperCase())
    .optional(),
});

export class UpdateMajorDto extends createZodDto(UpdateMajorSchema) {}
