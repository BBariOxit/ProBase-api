import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { emailSchema } from '../../common/email.schema';

export const ForgotPasswordSchema = z.object({
  email: emailSchema,
});

export class ForgotPasswordDto extends createZodDto(ForgotPasswordSchema) {}
