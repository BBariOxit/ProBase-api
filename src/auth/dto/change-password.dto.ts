import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { passwordSchema } from '../../common/password.schema';

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from current password',
    path: ['newPassword'],
  });

export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}
