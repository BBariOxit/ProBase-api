import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateProjectTypeSchema = z.object({
  name: z.string().min(1, 'Vui lòng nhập tên loại đồ án').max(255),
  code: z
    .string()
    .min(1, 'Vui lòng nhập mã loại đồ án')
    .max(50)
    .transform((val) => val.toUpperCase()),
});

export class CreateProjectTypeDto extends createZodDto(
  CreateProjectTypeSchema,
) {}
