import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { TopicProposalStatus } from '../../../generated/prisma/client';

/**
 * One list endpoint, read differently by the two people who use it: a student
 * sees what they sent, a lecturer sees what was sent to them. Which of the two
 * is decided by the token, not by a parameter — there is no way to ask for
 * somebody else's.
 */
export const QueryProposalsSchema = z.object({
  status: z.enum(TopicProposalStatus).optional(),
  semesterId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export class QueryProposalsDto extends createZodDto(QueryProposalsSchema) {}
