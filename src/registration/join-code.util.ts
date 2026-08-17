import { randomBytes } from 'crypto';

/** How long a declared group's remaining seats stay reachable only by link. */
export const SEAT_HOLD_HOURS = 24;

/**
 * The secret in a group's join link.
 *
 * 128 bits from the CSPRNG, base64url so it survives being pasted into a chat
 * message and a URL unescaped. Guessing matters here: during the hold window the
 * code is the only thing standing between a stranger and the seat a leader is
 * keeping for a friend, which is exactly the failure free joining was supposed
 * to avoid. A counter or Math.random would hand that away.
 *
 * Stored in plain text, unlike the password-reset tokens in AuthService, and for
 * a reason rather than by oversight: a reset token is shown once in an email, but
 * a leader comes back to copy this link again, so it has to remain readable. The
 * exposure is bounded to what the code grants — joining one group that has room —
 * and reads are restricted to the group's own members.
 */
export function generateJoinCode(): string {
  return randomBytes(16).toString('base64url');
}

export function holdExpiryFromNow(): Date {
  return new Date(Date.now() + SEAT_HOLD_HOURS * 60 * 60 * 1000);
}

/** Whether a hold is still standing. A null or past deadline is not. */
export function isHoldActive(holdUntil: Date | null): boolean {
  return holdUntil !== null && holdUntil.getTime() > Date.now();
}
