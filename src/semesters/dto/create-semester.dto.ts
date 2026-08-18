import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * The term itself. The registration window is absent because it belongs to a
 * round — a semester runs one per kind of project, and Tốt nghiệp almost always
 * opens and closes on different dates from Cơ sở. See `PUT /semesters/:id/rounds`.
 */
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
    gradeSubmissionDeadline: z.coerce.date().optional(),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: 'Ngày kết thúc phải sau ngày bắt đầu',
    path: ['endDate'],
  });

export class CreateSemesterDto extends createZodDto(CreateSemesterSchema) {}
