import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateMajorSchema = z.object({
  name: z.string().min(1, 'Major name is required').max(255),
  code: z
    .string()
    .min(1, 'Major code is required')
    .max(50)
    .transform((val) => val.toUpperCase()),
  departmentId: z
    .number()
    .int()
    .positive('Department ID must be a positive integer'),
});

export class CreateMajorDto extends createZodDto(CreateMajorSchema) {}
