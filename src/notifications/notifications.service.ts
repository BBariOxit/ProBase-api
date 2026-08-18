import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  GroupMemberStatus,
  NotificationType,
  Prisma,
  RegistrationGroupStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryNotificationsDto } from './dto/query-notifications.dto';

/**
 * One notice waiting to be written.
 *
 * `targetId` is the primary key of whatever the notice is about, paired with
 * `type` so the client knows which table it refers to and can send the reader
 * there instead of dead-ending on a line of text.
 */
export interface NewNotification {
  userId: number;
  type: NotificationType;
  title: string;
  content: string;
  targetId?: number | null;
}

const LIST_SELECT = {
  id: true,
  type: true,
  title: true,
  content: true,
  targetId: true,
  isRead: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── the inbox ─────────────────────────────────────────────

  /**
   * The caller's own notices, newest first, with the unread count alongside.
   *
   * The count comes back with the page rather than from a second endpoint
   * because the bell needs both at once, and two requests for one badge is two
   * chances for the badge and the list to disagree.
   */
  async findMine(query: QueryNotificationsDto, userId: number) {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unreadOnly && { isRead: false }),
    };

    const [items, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        select: LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      items,
      total,
      unreadCount,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  /**
   * Marks one notice read.
   *
   * Scoped by owner in the `where` rather than loaded and checked afterwards, so
   * there is no window in which somebody else's row is in hand. A notice that is
   * not the caller's answers exactly like one that does not exist — telling a
   * stranger which ids are real is itself a leak, however small.
   */
  async markRead(id: number, userId: number) {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });

    if (count === 0) throw new NotFoundException('Notification not found');

    return { message: 'Notification marked as read' };
  }

  async markAllRead(userId: number) {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    return { message: `${count} notification(s) marked as read` };
  }

  // ── raising notices ───────────────────────────────────────

  /**
   * Writes notices, and never lets writing one break what caused it.
   *
   * Every caller reaches this *after* its own transaction has committed, and a
   * failure here is swallowed with a log line. The alternative — writing inside
   * the business transaction — means a database hiccup on a notice rolls back a
   * student's registration, which trades something that matters for something
   * that does not. A notice that never arrives is a worse day; a registration
   * that silently did not happen is a worse system.
   */
  async notify(notices: NewNotification[]): Promise<void> {
    if (notices.length === 0) return;

    try {
      await this.prisma.notification.createMany({
        data: notices.map((notice) => ({
          userId: notice.userId,
          type: notice.type,
          title: notice.title,
          content: notice.content,
          targetId: notice.targetId ?? null,
        })),
      });
    } catch (err) {
      this.logger.error(
        `Failed to write ${notices.length} notification(s) of type ${notices[0].type}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * The accounts of every student a round reopened for: eligible by intake, and
   * without a group in that semester.
   *
   * The second half is what makes the notice worth sending. A student who
   * already has a group is unaffected by an extension, and telling them
   * otherwise would have them open the app to find nothing has changed — while
   * the students the extension exists for are exactly the ones who have stopped
   * expecting anything to change.
   *
   * Locked accounts are left out: a notice is an invitation to act, and that
   * account cannot.
   */
  async studentsWithoutGroupIn(round: {
    semesterId: number;
    cohorts: string[];
  }): Promise<number[]> {
    if (round.cohorts.length === 0) return [];

    const students = await this.prisma.studentProfile.findMany({
      where: {
        cohort: { in: round.cohorts },
        user: { isActive: true },
        NOT: {
          groupMemberships: {
            some: {
              semesterId: round.semesterId,
              status: GroupMemberStatus.ACCEPTED,
              group: { status: { not: RegistrationGroupStatus.REJECTED } },
            },
          },
        },
      },
      select: { userId: true },
    });

    return students.map((student) => student.userId);
  }
}
