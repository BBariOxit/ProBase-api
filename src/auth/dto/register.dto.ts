import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const RegisterSchema = z.object({
  email: z.email(),
  password: z.string().min(6),
  role: z.enum(['STUDENT', 'LECTURER']),
});

export class RegisterDto extends createZodDto(RegisterSchema) {}
