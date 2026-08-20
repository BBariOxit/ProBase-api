import {
  Prisma,
  RegistrationGroupStatus,
  TopicStatus,
} from '../../generated/prisma/client';

/**
 * Where a topic stands once its round is settled — and where it goes back to if
 * that round is unlocked again.
 *
 * Until now nothing ever wrote IN_PROGRESS or COMPLETED: every topic in the
 * catalogue said "đang mở đăng ký" forever, including the ones whose groups had
 * been working for two months. That is not only wrong on screen, it leaves the
 * faculty with no way to count how much of a term is actually under way, which
 * is the first number any report about progress is built on.
 *
 * COMPLETED is deliberately not set here. A topic is finished when its grades
 * are, and that belongs to the marking deadline rather than to registration.
 *
 * These are plain functions rather than a service because both callers already
 * hold a transaction: finalising a round and unlocking one must not be able to
 * half-happen, and a topic left mid-flight would be the half that gets noticed
 * three weeks later.
 */

/** A group that still holds its topic: accepted by the office, not turned down. */
const LIVE_GROUP = {
  status: { not: RegistrationGroupStatus.REJECTED },
} satisfies Prisma.RegistrationGroupWhereInput;

/**
 * Marks every topic in a round that a group actually took as under way.
 *
 * Topics nobody took are left exactly as their supervisor left them, and that
 * is the deliberate half of this. Closing them would read better on the
 * catalogue — a settled round has no registration left to offer — but it also
 * throws away which topics the lecturer had opened and which they never did,
 * and `unlock` would have no way to put that back. Registration is already shut
 * by the round's phase, so nothing is actually on offer either way.
 *
 * Returns how many topics changed, for the audit entry: it is the one number
 * that says how much of the term this round set running.
 */
export async function markTopicsUnderway(
  tx: Prisma.TransactionClient,
  roundId: number,
): Promise<number> {
  const { count } = await tx.topic.updateMany({
    where: {
      roundId,
      status: { in: [TopicStatus.OPEN, TopicStatus.APPROVED] },
      registrationGroups: { some: LIVE_GROUP },
    },
    data: { status: TopicStatus.IN_PROGRESS },
  });

  return count;
}

/**
 * Puts a round's topics back on offer, for an unlock.
 *
 * Only the topics this module set running are touched, which is why the filter
 * is IN_PROGRESS rather than "everything in the round" — a topic the supervisor
 * had never opened must not come back open, or the office would be able to place
 * a student on a topic nobody agreed to take.
 *
 * They return to OPEN rather than to whatever they were before, because that is
 * not recorded anywhere and inventing it would be worse than one known rule. The
 * case it gets wrong is narrow: a supervisor who closed their topic *after* a
 * group had formed on it finds it open again after an unlock, with its seats
 * still filled by that group and therefore nothing for anyone to take.
 */
export async function markTopicsBackOnOffer(
  tx: Prisma.TransactionClient,
  roundId: number,
): Promise<number> {
  const { count } = await tx.topic.updateMany({
    where: { roundId, status: TopicStatus.IN_PROGRESS },
    data: { status: TopicStatus.OPEN },
  });

  return count;
}
