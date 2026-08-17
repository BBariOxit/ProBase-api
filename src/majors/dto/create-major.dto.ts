import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateMajorSchema = z.object({
  name: z.string().min(1, 'Vui lòng nhập tên ngành').max(255),
  code: z
    .string()
    .min(1, 'Vui lòng nhập mã ngành')
    .max(50)
    .transform((val) => val.toUpperCase()),
});

export class CreateMajorDto extends createZodDto(CreateMajorSchema) {}
