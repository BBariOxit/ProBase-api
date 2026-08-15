import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { passwordSchema } from '../../common/password.schema';

export const ResetPasswordSchema = z.object({
  // The raw token from the emailed link. Only its hash is ever stored, so this
  // value exists solely in the user's mailbox and in this request.
  token: z.string().min(1, 'Reset token is required'),
  newPassword: passwordSchema,
});

export class ResetPasswordDto extends createZodDto(ResetPasswordSchema) {}
