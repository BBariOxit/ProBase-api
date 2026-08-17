import { BadRequestException, HttpStatus } from '@nestjs/common';
import { createZodValidationPipe } from 'nestjs-zod';

/** One Zod issue, as far as anything here needs to care. */
interface ZodIssueLike {
  message?: unknown;
  path?: unknown;
}

/** The first issue's message, or nothing if the error is not shaped as expected. */
function firstIssueMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('issues' in error)) return null;

  const { issues } = error;
  if (!Array.isArray(issues) || issues.length === 0) return null;

  const [first] = issues as ZodIssueLike[];
  return typeof first.message === 'string' ? first.message : null;
}

/**
 * Validation failures that say what is wrong in the reply everyone reads.
 *
 * nestjs-zod puts `"Validation failed"` at the top level and hides the real
 * messages in a nested `errors` array. That is a defensible shape for a machine
 * and useless for a person: the client shows `body.message`, so someone who
 * mistyped their email was told "Validation failed", in English, while
 * "Email không đúng định dạng" sat one level down untouched. Every message on a
 * schema in this project was unreachable for the same reason.
 *
 * So the first issue's message is promoted to `message`, and `errors` is kept
 * exactly as it was for anything that wants the full list — the field paths
 * included, which is what a form needs to highlight the right input.
 *
 * The first issue rather than all of them joined: Zod reports in field order, a
 * form is filled in field order, and a wall of every problem at once is how
 * people stop reading error messages.
 */
class ValidationException extends BadRequestException {
  constructor(error: unknown) {
    const issues =
      error && typeof error === 'object' && 'issues' in error
        ? error.issues
        : undefined;

    super({
      statusCode: HttpStatus.BAD_REQUEST,
      message: firstIssueMessage(error) ?? 'Dữ liệu không hợp lệ',
      errors: issues,
    });
  }
}

export const ZodValidationPipe = createZodValidationPipe({
  createValidationException: (error) => new ValidationException(error),
});
