import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateSemesterSchema = z
  .object({
    name: z.string().min(1, 'Vui lòng nhập tên học kỳ').max(255),
    code: z
      .string()
      .min(1, 'Vui lòng nhập mã học kỳ')
      .max(50)
      .transform((val) => val.toUpperCase()),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    registrationStart: z.coerce.date(),
    registrationEnd: z.coerce.date(),
    gradeSubmissionDeadline: z.coerce.date().optional(),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: 'Ngày kết thúc phải sau ngày bắt đầu',
    path: ['endDate'],
  })
  .refine((data) => data.registrationEnd > data.registrationStart, {
    message: 'Ngày kết thúc đăng ký phải sau ngày mở đăng ký',
    path: ['registrationEnd'],
  });

export class CreateSemesterDto extends createZodDto(CreateSemesterSchema) {}
