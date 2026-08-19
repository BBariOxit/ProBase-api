import {
  GroupMemberStatus,
  Prisma,
  RegistrationGroupStatus,
} from '../../generated/prisma/client';

/**
 * What narrows a roster of students.
 *
 * Every field is optional and they compose: the faculty's whole list is this
 * with nothing set, and the allocation desk is this with a semester, a set of
 * intakes and `hasGroup: false`.
 */
export interface RosterFilters {
  /** Which term decides whether a student counts as having a group. */
  semesterId?: number;
  /** Intake years, as a round's eligibility declares them — `["2022"]`. */
  cohorts?: string[];
  cohort?: string;
  majorId?: number;
  /** Matched loosely: a class code is typed by hand more often than picked. */
  class?: string;
  /** Whose supervision they are under, through their group's topic. */
  lecturerId?: number;
  /** True for students who hold a place this term, false for those who do not. */
  hasGroup?: boolean;
  /** Name or student code. */
  q?: string;
  /** Only accounts somebody could still sign in to. Defaults to true. */
  activeOnly?: boolean;
}

/**
 * A live membership: accepted, in a group nobody has turned down.
 *
 * This is the definition of "has a topic this term", and it is the reason this
 * file exists. It used to be written out separately in the allocation desk and
 * would have been written out a third time by the faculty roster — three copies
 * of one rule, which is three chances for two screens to report different
 * numbers about the same student.
 */
function liveMembership(
  semesterId: number | undefined,
): Prisma.RegistrationGroupMemberWhereInput {
  return {
    ...(semesterId !== undefined && { semesterId }),
    status: GroupMemberStatus.ACCEPTED,
    group: { status: { not: RegistrationGroupStatus.REJECTED } },
  };
}

/**
 * The filters, as a query.
 *
 * Pure on purpose: it takes an object and returns an object, which is what makes
 * the rule above testable without a database — and the rule above is the one
 * that must never drift between two screens.
 */
export function rosterWhere(
  filters: RosterFilters,
): Prisma.StudentProfileWhereInput {
  const membership = liveMembership(filters.semesterId);

  return {
    // A locked or departed account is not somebody the faculty is still
    // administering, so it stays out unless somebody asks for everything.
    ...(filters.activeOnly !== false && { user: { isActive: true } }),

    ...(filters.cohorts?.length && { cohort: { in: filters.cohorts } }),
    ...(filters.cohort && { cohort: filters.cohort }),
    ...(filters.majorId && { majorId: filters.majorId }),
    ...(filters.class && {
      class: { contains: filters.class, mode: 'insensitive' },
    }),

    ...(filters.q && {
      OR: [
        { fullName: { contains: filters.q, mode: 'insensitive' } },
        { studentCode: { contains: filters.q, mode: 'insensitive' } },
      ],
    }),

    /*
      `some` and `none` rather than a boolean column, because holding a place is
      not a fact about the student — it is a row in another table that a leader,
      the office, or the student themselves can remove. Asking the relation is
      the only version that cannot go stale.
    */
    ...(filters.hasGroup === true && {
      groupMemberships: { some: membership },
    }),
    ...(filters.hasGroup === false && {
      groupMemberships: { none: membership },
    }),

    // Supervision reaches through the group to the topic, so it implies having
    // one — a student with no group has no supervisor to be filtered by.
    ...(filters.lecturerId && {
      groupMemberships: {
        some: {
          ...membership,
          group: { topic: { lecturerId: filters.lecturerId } },
        },
      },
    }),
  };
}

/**
 * One row of the roster.
 *
 * Includes the office's private note, which is why every caller of this select
 * is admin-only: it is the faculty's own remark about a student ("bảo lưu HK1",
 * "gọi không nghe máy") and the one field in this system that must never reach
 * the person it is about.
 */
export const ROSTER_SELECT = {
  id: true,
  studentCode: true,
  fullName: true,
  class: true,
  cohort: true,
  note: true,
  major: { select: { id: true, name: true, code: true } },
  user: { select: { id: true, email: true, isActive: true, avatarUrl: true } },
} satisfies Prisma.StudentProfileSelect;

/**
 * The group a student holds this term, fetched separately rather than joined.
 *
 * A student has at most one live membership per semester, but Prisma has no way
 * to say "the one row matching this" in a select — it can only take a list. So
 * the membership comes back as an array of at most one and is flattened here,
 * which keeps every caller from unwrapping it slightly differently.
 */
export const ROSTER_MEMBERSHIP_SELECT = {
  select: {
    group: {
      select: {
        id: true,
        name: true,
        topic: {
          select: {
            id: true,
            title: true,
            round: {
              select: {
                projectType: { select: { id: true, name: true, code: true } },
              },
            },
            lecturer: {
              select: { id: true, fullName: true, academicTitle: true },
            },
          },
        },
      },
    },
  },
  take: 1,
} satisfies { select: Prisma.RegistrationGroupMemberSelect; take: number };

/** The membership filter, for callers that need it on the relation itself. */
export function liveMembershipWhere(semesterId: number | undefined) {
  return liveMembership(semesterId);
}
