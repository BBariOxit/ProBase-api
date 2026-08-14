import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Role } from '../../../generated/prisma/client';

export const CreateUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.nativeEnum(Role),
});

export class CreateUserDto extends createZodDto(CreateUserSchema) {}
