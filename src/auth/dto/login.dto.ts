import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { emailSchema } from '../../common/email.schema';

export const LoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
});

export class LoginDto extends createZodDto(LoginSchema) {}
