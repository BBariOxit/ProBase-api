import { z } from 'zod';

/**
 * Every email that reaches the database goes through here.
 *
 * Postgres's unique index is case-sensitive, so without normalising we get two
 * failures that look unrelated but share one cause: a roster row spelled
 * `Nguyen.VanA@sv.edu.vn` creates an account that its owner can never log into
 * (they type it lowercase, `findUnique` misses), and two rows differing only in
 * case slip past every duplicate check to become two accounts for one person.
 *
 * Trim runs before validation so a stray space from a spreadsheet cell is a
 * non-event rather than a rejected row.
 */
export const emailSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.email('Invalid email address'));
