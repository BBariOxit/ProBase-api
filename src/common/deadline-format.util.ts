/**
 * Deadlines as a reader sees them in a notice.
 *
 * UTC on purpose, and this is the one detail worth knowing. Every deadline in
 * this system is a calendar day the office picked, which the client sends as
 * midnight UTC of that day — so formatting in the server's local zone shifts it
 * by the offset and prints the day before. The deadline is the one number in a
 * reminder that has to be right.
 *
 * Shared rather than written per caller, because two notices about the same
 * deadline printing it differently is how a reader decides one of them is wrong.
 */

const DATE = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `20/08/2026`. */
export function formatDate(value: Date): string {
  return DATE.format(value);
}
