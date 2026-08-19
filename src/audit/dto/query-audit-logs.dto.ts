import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Three filters, and they are the three questions somebody actually opens an
 * audit log with: what happened, who did it, and to which record.
 *
 * `action` is a free string rather than an enum because that is what the column
 * is — every call site names its own action, and a list here would go stale the
 * first time somebody added one without remembering this file. The screen offers
 * the actions that exist rather than the actions this file imagined.
 */
export const QueryAuditLogsSchema = z.object({
  action: z.string().trim().min(1).max(100).optional(),
  userId: z.coerce.number().int().positive().optional(),
  targetTable: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export class QueryAuditLogsDto extends createZodDto(QueryAuditLogsSchema) {}
