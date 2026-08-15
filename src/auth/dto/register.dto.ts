import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { emailSchema } from '../../common/email.schema';
import { passwordSchema } from '../../common/password.schema';

export const RegisterSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(['STUDENT', 'LECTURER']),
});

export class RegisterDto extends createZodDto(RegisterSchema) {}
