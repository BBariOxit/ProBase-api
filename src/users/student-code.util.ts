/**
 * A student code carries the year of admission in its first two digits:
 * `2212345` is intake 2022, sequence 12345. The university email is that same
 * code plus the domain — `2212345@dlu.edu.vn` — which makes the code the one
 * piece of data that cannot disagree with itself.
 *
 * The cohort is therefore derived, never taken from a spreadsheet column. A
 * hand-typed column arrives as "2021", "K45", "21" and blanks in the same
 * file, and every rule built on it — which project type a student may take
 * this semester, above all — decays quietly from there.
 */
const STUDENT_CODE = /^(\d{2})(\d{5})$/;

/**
 * Đại học Đà Lạt numbers its intakes from 1977, so intake 2022 is K46. Kept
 * as a named constant because it is an institutional fact, not arithmetic:
 * another university would change this one line and nothing else.
 */
const COHORT_EPOCH = 1976;

/**
 * Two-digit years are read into the current century. A code is issued at
 * enrolment and read within a few years of it, so this stays unambiguous for
 * the lifetime of any record the system will hold.
 */
function toFullYear(twoDigitYear: string): number {
  const century = Math.floor(new Date().getFullYear() / 100) * 100;
  return century + Number(twoDigitYear);
}

/** The year of admission as four digits, or null if the code is not one. */
export function cohortFromStudentCode(studentCode: string): string | null {
  const match = STUDENT_CODE.exec(studentCode.trim());
  if (!match) return null;

  return String(toFullYear(match[1]));
}

/** "2022" → 46. Display only; nothing is stored in this form. */
export function khoaFromCohort(cohort: string): number {
  return Number(cohort) - COHORT_EPOCH;
}

/**
 * 46 → "2022". The inverse of the above, for reading a cohort back out of the
 * one place that writes it in K-form: the class code (`CTK46PM`).
 *
 * It lives here so COHORT_EPOCH stays a single institutional fact rather than a
 * number repeated wherever somebody needs to convert.
 */
export function cohortFromKhoa(khoa: number): string {
  return String(khoa + COHORT_EPOCH);
}

/**
 * The email's local part must be the student code. They are the same string
 * at the university, so a row where they differ is a spreadsheet mistake — and
 * silently trusting either one would put the wrong cohort on the account.
 */
export function studentCodeMatchesEmail(
  studentCode: string,
  email: string,
): boolean {
  return email.split('@')[0].trim() === studentCode.trim();
}
