import { cohortFromKhoa, cohortFromStudentCode } from './student-code.util';

/**
 * A class code re-encodes information that already has its own source.
 *
 * `CTK46PM` says two things — intake K46 and a major — and the system already
 * knows both from elsewhere: the cohort is derived from the student code, and
 * the major arrives as its own `majorCode` column. That makes three sources for
 * two facts, and the class code was until now the only one nobody checked. A row
 * saying `2212345` (K46), `majorCode = HTTT` and `class = CTK46PM` used to
 * import cleanly, after which nothing recorded which of the two majors was
 * meant.
 *
 * So the code is parsed and cross-checked rather than stored as free text. What
 * can be checked exactly is checked exactly; what cannot is reported rather than
 * guessed at — see `majorSuffix` below.
 */

/**
 * Deliberately lenient about separators and case: `CTK46PM`, `ctk46pm` and
 * `CT-K46-PM` are the same class, and rejecting a roster over a hyphen would
 * teach the office to work around the check rather than fix the data.
 *
 * The suffix is required to be letters only, so a stray trailing digit makes the
 * code unrecognised instead of silently parsing to something else.
 */
const CLASS_CODE = /^CT[\s-]*K(\d{2})[\s-]*([A-Za-z]+)$/;

export interface ParsedClassCode {
  /** Intake number as written after the K. `CTK46PM` → 46. */
  khoa: number;
  /** Year of admission the khoa implies, in the form StudentProfile.cohort uses. */
  cohort: string;
  /**
   * The major abbreviation trailing the code (`PM`, `MMT`).
   *
   * Not comparable to `majors.code` — the faculty writes `PM` here for the major
   * coded `KTPM` — so this cannot be validated against master data without a
   * mapping the faculty owns and the system does not yet hold. It is still worth
   * parsing: two rows sharing a class code must share a major, which catches a
   * mistyped `majorCode` without needing that mapping at all.
   */
  majorSuffix: string;
  /** Upper-cased, separators stripped — the form to compare two codes by. */
  normalised: string;
}

export type ClassCodeCheck =
  /** No class code given. The column is optional, so there is nothing to check. */
  | { status: 'absent' }
  /** Parsed, and its cohort agrees with the student code. */
  | { status: 'ok'; parsed: ParsedClassCode }
  /** Not in the faculty's usual shape — accepted, but said out loud. */
  | { status: 'unrecognised'; warning: string }
  /** Parsed, and contradicts the student code. The row is wrong. */
  | { status: 'contradiction'; error: string };

export function parseClassCode(value: string): ParsedClassCode | null {
  const match = CLASS_CODE.exec(value.trim());
  if (!match) return null;

  const khoa = Number(match[1]);
  const majorSuffix = match[2].toUpperCase();

  return {
    khoa,
    cohort: cohortFromKhoa(khoa),
    majorSuffix,
    normalised: `CTK${khoa}${majorSuffix}`,
  };
}

/**
 * Cross-checks a class code against the student code on the same row.
 *
 * An unrecognised shape is a warning rather than an error on purpose. Faculties
 * run classes the pattern does not cover — merged classes, honours streams, a
 * new naming scheme — and refusing those rows would stop the office importing a
 * perfectly valid roster because the system had not been taught its format yet.
 * A contradiction is different: both halves of the row claim to know the intake
 * and they disagree, so one of them is a typo, and choosing a winner silently is
 * how a student ends up in the wrong cohort and then cannot register.
 */
export function checkClassCode(
  classCode: string | undefined,
  studentCode: string,
): ClassCodeCheck {
  if (!classCode?.trim()) return { status: 'absent' };

  const parsed = parseClassCode(classCode);
  if (!parsed) {
    return {
      status: 'unrecognised',
      warning: `class "${classCode}" is not in the CTK{khoa}{major} form — cohort was taken from the student code and the class was stored as given`,
    };
  }

  const cohortFromCode = cohortFromStudentCode(studentCode);
  if (cohortFromCode && parsed.cohort !== cohortFromCode) {
    return {
      status: 'contradiction',
      error: `class "${classCode}" is intake ${parsed.cohort} but student code "${studentCode}" is intake ${cohortFromCode} — fix whichever is wrong`,
    };
  }

  return { status: 'ok', parsed };
}
