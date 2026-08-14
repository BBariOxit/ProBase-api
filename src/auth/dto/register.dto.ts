import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { emailSchema } from '../../common/email.schema';

export const RegisterSchema = z.object({
  email: emailSchema,
  password: z.string().min(6),
  role: z.enum(['STUDENT', 'LECTURER']),
});

export class RegisterDto extends createZodDto(RegisterSchema) {}
