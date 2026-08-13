import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Role } from '../../../generated/prisma/client';

export const QueryUsersSchema = z.object({
  role: z.nativeEnum(Role).optional(),
  isActive: z
    .string()
    .optional()
    .transform((val) => {
      if (val === 'true') return true;
      if (val === 'false') return false;
      return undefined;
    }),
  search: z.string().optional(),
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1))
    .pipe(z.number().int().min(1).default(1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20))
    .pipe(z.number().int().min(1).max(100).default(20)),
});

export class QueryUsersDto extends createZodDto(QueryUsersSchema) {}
