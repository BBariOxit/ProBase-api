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
    .transform((val) => {
      const n = val ? parseInt(val, 10) : 1;
      return isNaN(n) || n < 1 ? 1 : n;
    }),
  limit: z
    .string()
    .optional()
    .transform((val) => {
      const n = val ? parseInt(val, 10) : 20;
      if (isNaN(n) || n < 1) return 20;
      if (n > 100) return 100;
      return n;
    }),
});

export class QueryUsersDto extends createZodDto(QueryUsersSchema) {}
