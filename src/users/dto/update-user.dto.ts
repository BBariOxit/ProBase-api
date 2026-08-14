import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Role } from '../../../generated/prisma/client';
import { emailSchema } from '../../common/email.schema';

export const UpdateUserSchema = z
  .object({
    email: emailSchema.optional(),
    role: z.nativeEnum(Role).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export class UpdateUserDto extends createZodDto(UpdateUserSchema) {}
