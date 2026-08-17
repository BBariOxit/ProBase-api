import { Prisma } from '../../generated/prisma/client';

/**
 * Reads which unique constraint a P2002 tripped.
 *
 * Prisma reports this in two different shapes and the one that applies here is
 * the less obvious of them. Through a driver adapter — which is how this service
 * connects, since Prisma 7 has no implicit datasource — `meta.target` is not set
 * at all; the constraint name and columns arrive under
 * `meta.driverAdapterError.cause` instead. Code reading only `meta.target` looks
 * correct, compiles, and silently never matches.
 *
 * Both shapes are read so that neither a change of adapter nor a Prisma upgrade
 * quietly turns precise errors back into generic ones.
 */

interface AdapterCause {
  originalMessage?: unknown;
  constraint?: { fields?: unknown; index?: unknown };
}

function adapterCause(
  err: Prisma.PrismaClientKnownRequestError,
): AdapterCause | null {
  const adapterError = (
    err.meta as { driverAdapterError?: unknown } | undefined
  )?.driverAdapterError;

  if (typeof adapterError !== 'object' || adapterError === null) return null;

  const cause = (adapterError as { cause?: unknown }).cause;
  if (typeof cause !== 'object' || cause === null) return null;

  return cause;
}

/** True when this error is a unique-constraint violation. */
export function isUniqueViolation(
  err: unknown,
): err is Prisma.PrismaClientKnownRequestError {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/**
 * The constraint's own name, lower-cased, or '' when the driver did not say.
 *
 * This is what identifies a *partial* unique index: Postgres names it, but its
 * columns say nothing about the WHERE clause that makes it partial, so two
 * partial indexes over the same columns are indistinguishable by field list.
 */
export function uniqueConstraintName(
  err: Prisma.PrismaClientKnownRequestError,
): string {
  const cause = adapterCause(err);
  const index = cause?.constraint?.index;
  if (typeof index === 'string') return index.toLowerCase();

  // Postgres puts the name in the message text even when nothing structured
  // carries it: `... violates unique constraint "some_index_name"`.
  const message = cause?.originalMessage;
  if (typeof message === 'string') {
    const quoted = /unique constraint "([^"]+)"/.exec(message);
    if (quoted) return quoted[1].toLowerCase();
  }

  return '';
}

/**
 * The columns the constraint covers, lower-cased and unquoted.
 *
 * Returns an empty array when the driver gave nothing to work with, so callers
 * can tell "some other column" apart from "we do not know".
 */
export function uniqueConstraintFields(
  err: Prisma.PrismaClientKnownRequestError,
): string[] {
  const fields = adapterCause(err)?.constraint?.fields;

  if (Array.isArray(fields)) {
    return fields.map((field) =>
      String(field).replace(/"/g, '').trim().toLowerCase(),
    );
  }

  // Pre-adapter shape: a plain array of column names, or a single string.
  const target = err.meta?.target;
  if (Array.isArray(target)) {
    return (target as unknown[]).map((field) => String(field).toLowerCase());
  }

  return typeof target === 'string' ? [target.toLowerCase()] : [];
}
