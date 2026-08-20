/**
 * The calendar days the faculty office names, and the instants they really mean.
 *
 * Every deadline in this system is a day somebody picked out of a date box —
 * "mở đăng ký 01/09", "hạn nộp 22/08" — which the client sends as midnight UTC
 * of that day. Read literally that is seven in the morning in Vietnam, so a
 * round announced as closing on the 2nd shut during breakfast on the 2nd, and a
 * report due on the 22nd counted as late from breakfast on the 22nd. Both are
 * the system disagreeing with its own announcement, and the second one costs a
 * student marks.
 *
 * So a named day is treated as the whole day it names, in the timezone the
 * faculty lives in: it begins at midnight and ends twenty-four hours later. The
 * two functions below are the only place that conversion happens, because a
 * screen counting down one way while the API measures another is how "còn 1
 * ngày" and "quá hạn" end up on the same page.
 */

/** Vietnam is UTC+7 and has no daylight saving, so one constant covers it. */
const OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const DATE = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * The day this value names, printed as `20/08/2026`.
 *
 * Formatted in UTC because that is the zone the day was stored in; the server's
 * own zone would shift it and print the day before.
 */
export function formatDate(value: Date): string {
  return DATE.format(value);
}

/**
 * Midnight in Vietnam on the day this value names.
 *
 * Read off the stored value's own date parts rather than by subtracting seven
 * hours from it, so it still means the right thing if a client ever sends
 * something that is not exactly midnight.
 */
export function startOfNamedDay(value: Date): number {
  return (
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) -
    OFFSET_MS
  );
}

/** The end of that same day: the first instant that is no longer it. */
export function endOfNamedDay(value: Date): number {
  return startOfNamedDay(value) + DAY_MS;
}
