import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

/**
 * The trail, read.
 *
 * Rows have been written to this table for a while — a failed sign-in, a leader
 * taking somebody's place away, a round reopened, a student placed by hand — and
 * until now nothing could read a single one of them back. An audit log nobody
 * can open is not a record, it is a table that grows.
 *
 * Read-only on purpose, and there is no write endpoint anywhere: entries are
 * made by the services that perform the actions, inside the same transaction, so
 * a record cannot exist without the change it describes or the other way round.
 * Nothing edits or deletes one either. A log somebody can tidy up answers no
 * question worth asking.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryAuditLogsDto) {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action && { action: query.action }),
      ...(query.userId && { userId: query.userId }),
      ...(query.targetTable && { targetTable: query.targetTable }),
    };

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        select: {
          id: true,
          action: true,
          targetTable: true,
          targetId: true,
          // The before and after are the whole point — an entry saying only
          // "somebody updated something" is one nobody can act on. They are
          // written by each call site and are deliberately not a fixed shape.
          oldValue: true,
          newValue: true,
          createdAt: true,
          // Who, as a person rather than an id. An admin reading this already
          // has the account list, so nothing new is exposed by naming them.
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              studentProfile: { select: { fullName: true } },
              lecturerProfile: { select: { fullName: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: items.map(render),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  /**
   * The kinds of action that actually occur, for the screen's filter.
   *
   * Read from the table rather than listed in code, so a service added next
   * month appears here the first time it writes anything — and a filter never
   * offers a value with nothing behind it.
   */
  async actions(): Promise<string[]> {
    const rows = await this.prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    });

    return rows.map((row) => row.action);
  }
}

type LogRow = Prisma.AuditLogGetPayload<{
  select: {
    id: true;
    action: true;
    targetTable: true;
    targetId: true;
    oldValue: true;
    newValue: true;
    createdAt: true;
    user: {
      select: {
        id: true;
        email: true;
        role: true;
        studentProfile: { select: { fullName: true } };
        lecturerProfile: { select: { fullName: true } };
      };
    };
  };
}>;

/** An admin has no profile row, so the address is the only name they have. */
function render(log: LogRow) {
  const { user, ...rest } = log;

  return {
    ...rest,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      fullName:
        user.studentProfile?.fullName ?? user.lecturerProfile?.fullName ?? null,
    },
  };
}
