import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  GroupMemberStatus,
  NotificationType,
  RegistrationGroupStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

/**
 * Two things about an inbox are worth pinning down, and neither is the happy
 * path.
 *
 * The first is that a notice is only ever reachable by the account it was
 * written for. This is the smallest surface in the system and the one where a
 * mistake is invisible: reading somebody else's notice returns a plausible
 * object, and nothing anywhere reports that the wrong person read it.
 *
 * The second is that raising a notice can never be the reason the thing that
 * caused it failed. Every caller reaches `notify` after its own transaction has
 * committed, so a throw here would surface as an error on an action that has
 * already succeeded — a student told their registration failed while the
 * database says it did not.
 */
describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    notification: { updateMany: jest.Mock; createMany: jest.Mock };
    studentProfile: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      notification: { updateMany: jest.fn(), createMany: jest.fn() },
      studentProfile: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  describe('markRead', () => {
    it('narrows the update by owner rather than by id alone', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 1 });

      await service.markRead(7, 42);

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 7, userId: 42 },
        data: { isRead: true },
      });
    });

    /**
     * Answering "not found" rather than "not yours" is deliberate. The second
     * confirms the notice exists, which is the one fact a stranger guessing ids
     * would be trying to learn.
     */
    it('reports a notice belonging to somebody else as missing', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.markRead(7, 42)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('notify', () => {
    it('does not reach the database when there is nobody to tell', async () => {
      await service.notify([]);

      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });

    /**
     * Nought rather than a throw, and the number matters as much as the
     * swallowing: a reminder job reads it to report how much it sent, and a
     * failed write that answered with the count it hoped for would have the job
     * log a morning's reminders that never left the building.
     */
    it('swallows a write failure, and reports that nothing was written', async () => {
      prisma.notification.createMany.mockRejectedValue(new Error('db down'));

      await expect(
        service.notify([
          {
            userId: 1,
            type: NotificationType.ROUND_EXTENDED,
            title: 'x',
            content: 'y',
          },
        ]),
      ).resolves.toBe(0);
    });
  });

  describe('studentsWithoutGroupIn', () => {
    it('asks nothing of the database when no intake is eligible', async () => {
      await expect(
        service.studentsWithoutGroupIn({ semesterId: 1, cohorts: [] }),
      ).resolves.toEqual([]);

      expect(prisma.studentProfile.findMany).not.toHaveBeenCalled();
    });

    /**
     * A locked account cannot act on a notice, and the notice is an invitation
     * to act. Leaving it out is not tidiness — it keeps the count of "students
     * we reopened for" honest.
     */
    it('excludes locked accounts and anyone already in a live group', async () => {
      prisma.studentProfile.findMany.mockResolvedValue([{ userId: 9 }]);

      await expect(
        service.studentsWithoutGroupIn({ semesterId: 3, cohorts: ['2022'] }),
      ).resolves.toEqual([9]);

      // Asserted whole rather than piecemeal: this query *is* the rule, and a
      // clause quietly dropped from it would widen who gets told without
      // failing anything.
      expect(prisma.studentProfile.findMany).toHaveBeenCalledWith({
        where: {
          cohort: { in: ['2022'] },
          user: { isActive: true },
          NOT: {
            groupMemberships: {
              some: {
                semesterId: 3,
                status: GroupMemberStatus.ACCEPTED,
                group: { status: { not: RegistrationGroupStatus.REJECTED } },
              },
            },
          },
        },
        select: { userId: true },
      });
    });
  });
});
