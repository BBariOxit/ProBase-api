import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Role } from '../../../generated/prisma/client';

export const CreateUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128),
  role: z.nativeEnum(Role),
});

export class CreateUserDto extends createZodDto(CreateUserSchema) {}
