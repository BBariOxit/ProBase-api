import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { SubmissionType } from '../../../generated/prisma/client';

/**
 * A link somebody may actually follow.
 *
 * Restricted to http and https rather than accepting any URL: `javascript:` and
 * `data:` are both valid URLs and both are a script waiting for a supervisor to
 * click it, on a screen that renders whatever the student typed.
 */
const externalLink = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (value) => /^https?:\/\//i.test(value),
    'Link phải bắt đầu bằng http:// hoặc https://',
  );

/**
 * What handing something in looks like.
 *
 * A file or a link, and at least one — the model has always had both columns
 * and the two are genuinely different things: a report is a file, source code is
 * a repository, and asking a student to zip a git history to upload it is asking
 * them to do something worse than what they already have.
 *
 * The file itself is not in this schema. It arrives as multipart and is checked
 * by its bytes rather than by anything a caller could write here, so the only
 * thing this can say about it is whether one was sent — which the service does,
 * because it is the half of "at least one" this schema cannot see.
 */
export const CreateSubmissionSchema = z.object({
  submissionType: z.enum(SubmissionType, {
    message: 'Vui lòng chọn loại bài nộp',
  }),
  submissionUrl: externalLink.optional(),
});

export class CreateSubmissionDto extends createZodDto(CreateSubmissionSchema) {}

/**
 * One list endpoint, read from whichever end the caller stands at: a student
 * sees their own group's, a supervisor sees what was handed in on their topics.
 * There is no parameter for whose, so there is nothing to tamper with.
 */
export const QuerySubmissionsSchema = z.object({
  submissionType: z.enum(SubmissionType).optional(),
  /** Staff only — a student's own group is decided by their token. */
  groupId: z.coerce.number().int().positive().optional(),
  topicId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export class QuerySubmissionsDto extends createZodDto(QuerySubmissionsSchema) {}

/**
 * The supervisor's answer.
 *
 * Required and non-empty for the same reason a rejected proposal's is: feedback
 * nobody can act on produces the same work again, read twice. There is no
 * grade here — marking is its own thing, with its own deadline and its own
 * table.
 */
export const SubmissionFeedbackSchema = z.object({
  feedback: z
    .string('Vui lòng nhập nhận xét cho nhóm')
    .trim()
    .min(1, 'Vui lòng nhập nhận xét cho nhóm')
    .max(4000),
});

export class SubmissionFeedbackDto extends createZodDto(
  SubmissionFeedbackSchema,
) {}
