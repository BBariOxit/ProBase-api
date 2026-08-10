import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateDepartmentSchema = z.object({
  name: z.string().min(1, 'Department name is required').max(255),
  code: z
    .string()
    .min(1, 'Department code is required')
    .max(50)
    .transform((val) => val.toUpperCase()),
});

export class CreateDepartmentDto extends createZodDto(CreateDepartmentSchema) {}
