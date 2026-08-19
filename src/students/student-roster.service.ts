import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ROSTER_MEMBERSHIP_SELECT,
  ROSTER_SELECT,
  liveMembershipWhere,
  rosterWhere,
  type RosterFilters,
} from './student-roster.query';

/**
 * One answer to "which students, and what are they working on".
 *
 * Two screens ask it: the faculty's whole roster, and the left-hand column of
 * the allocation desk — which is this list with a term, a set of intakes and
 * "no group" pinned. They look nothing alike and should not share a component,
 * but they must share this, because the alternative is two definitions of what
 * counts as having a topic and, sooner or later, two screens reporting different
 * numbers about the same student.
 *
 * Not paginated at this level. The roster pages because a faculty has hundreds;
 * the desk does not because the office works the whole list in one sitting. The
 * caller decides, and passes it through.
 */
@Injectable()
export class StudentRosterService {
  constructor(private readonly prisma: PrismaService) {}

  async find(
    filters: RosterFilters,
    paging?: { skip: number; take: number },
  ): Promise<RosterRow[]> {
    const rows = await this.prisma.studentProfile.findMany({
      where: rosterWhere(filters),
      select: {
        ...ROSTER_SELECT,
        groupMemberships: {
          ...ROSTER_MEMBERSHIP_SELECT,
          where: liveMembershipWhere(filters.semesterId),
        },
      },
      orderBy: { studentCode: 'asc' },
      ...(paging && { skip: paging.skip, take: paging.take }),
    });

    return rows.map(render);
  }

  count(filters: RosterFilters): Promise<number> {
    return this.prisma.studentProfile.count({ where: rosterWhere(filters) });
  }
}

/**
 * The at-most-one membership flattened into the field a reader actually wants.
 *
 * An array of one is how the constraint is expressed, not something every screen
 * should have to unwrap — and unwrapping it in two places is how one of them
 * eventually reads `[0]` on an empty array.
 */
function render(row: {
  id: number;
  studentCode: string;
  fullName: string;
  class: string | null;
  cohort: string | null;
  note: string | null;
  major: { id: number; name: string; code: string } | null;
  user: {
    id: number;
    email: string;
    isActive: boolean;
    avatarUrl: string | null;
  };
  groupMemberships: {
    group: {
      id: number;
      name: string | null;
      topic: {
        id: number;
        title: string;
        round: { projectType: { id: number; name: string; code: string } };
        lecturer: {
          id: number;
          fullName: string;
          academicTitle: string | null;
        };
      };
    };
  }[];
}) {
  const { user, groupMemberships, ...student } = row;
  const held = groupMemberships[0]?.group;

  return {
    ...student,
    userId: user.id,
    email: user.email,
    isActive: user.isActive,
    avatarUrl: user.avatarUrl,
    group: held
      ? {
          id: held.id,
          name: held.name,
          topic: {
            id: held.topic.id,
            title: held.topic.title,
            projectType: held.topic.round.projectType,
            lecturer: held.topic.lecturer,
          },
        }
      : null,
  };
}

export type RosterRow = ReturnType<typeof render>;
export type { RosterFilters };
