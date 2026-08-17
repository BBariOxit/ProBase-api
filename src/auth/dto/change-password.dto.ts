import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { passwordSchema } from '../../common/password.schema';

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Vui lòng nhập mật khẩu hiện tại'),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'Mật khẩu mới phải khác mật khẩu hiện tại',
    path: ['newPassword'],
  });

export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}
