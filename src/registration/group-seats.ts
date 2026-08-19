import { RegistrationGroupStatus } from '../../generated/prisma/client';

/**
 * A group filling up is what used to be a leader pressing Submit. Nobody presses
 * anything now, so the status follows the seat count — and follows it back down
 * when a member leaves, since a group that is no longer full is forming again.
 *
 * It lives in its own file because two paths write group membership: a student
 * registering or joining, and the faculty office placing somebody by hand once
 * the gate has shut. Two copies of this would be two answers to "is this group
 * full", and they would disagree the first time either changed.
 */
export function statusForSeats(
  occupied: number,
  capacity: number,
): RegistrationGroupStatus {
  return occupied >= capacity
    ? RegistrationGroupStatus.SUBMITTED
    : RegistrationGroupStatus.FORMING;
}
