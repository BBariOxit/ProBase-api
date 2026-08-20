import { Test, TestingModule } from '@nestjs/testing';
import {
  NotificationType,
  RoundPhase,
  SubmissionType,
} from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RoundPhaseService } from '../rounds/round-phase.service';
import { RemindersService } from './reminders.service';

/**
 * What has to hold for a job nobody watches.
 *
 * Three properties, and none of them is that a reminder gets sent. The first is
 * that a pass never looks backwards — a reminder about a deadline that has gone
 * is noise addressed to somebody who can no longer act. The second is that
 * running twice sends once, which is what the dedupe key buys and the reason
 * every key carries the deadline it is about: an extension is a new deadline and
 * has to be a new notice. The third is that nobody is written to about something
 * they have already done.
 */
describe('RemindersService', () => {
  let service: RemindersService;
  let prisma: {
    registrationRound: { findMany: jest.Mock };
    registrationGroup: { findMany: jest.Mock };
  };
  let notifications: {
    notify: jest.Mock;
    studentsWithoutGroupIn: jest.Mock;
  };
  let phases: { resolveMany: jest.Mock };

  /** A round whose gate closes in two days, with one intake declared. */
  const closingSoon = {
    id: 12,
    semesterId: 1,
    phase: RoundPhase.OPEN,
    registrationStart: new Date('2026-08-01T00:00:00.000Z'),
    registrationEnd: new Date('2026-08-22T00:00:00.000Z'),
    projectType: { name: 'Đồ án Tốt nghiệp' },
    eligibilities: [{ cohort: '2022' }],
  };

  beforeEach(async () => {
    prisma = {
      registrationRound: { findMany: jest.fn().mockResolvedValue([]) },
      registrationGroup: { findMany: jest.fn().mockResolvedValue([]) },
    };
    notifications = {
      notify: jest.fn().mockResolvedValue(0),
      studentsWithoutGroupIn: jest.fn().mockResolvedValue([]),
    };
    phases = {
      resolveMany: jest
        .fn()
        .mockImplementation((rounds: { id: number; phase: RoundPhase }[]) =>
          Promise.resolve(new Map(rounds.map((r) => [r.id, r.phase]))),
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RemindersService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: RoundPhaseService, useValue: phases },
      ],
    }).compile();

    service = module.get(RemindersService);
  });

  /** The notices handed to `notify`, flattened across both passes. */
  function sent() {
    return notifications.notify.mock.calls.flatMap(
      (call: [{ type: NotificationType; dedupeKey?: string }[]]) => call[0],
    );
  }

  describe('the window', () => {
    it('never reaches back past now', async () => {
      await service.run();

      const calls = prisma.registrationRound.findMany.mock.calls as [
        { where: Record<string, { gt: Date; lte: Date }> },
      ][];

      for (const [args] of calls) {
        const [range] = Object.values(args.where);

        expect(range.gt.getTime()).toBeLessThanOrEqual(Date.now());
        expect(range.lte.getTime()).toBeGreaterThan(range.gt.getTime());
      }
    });
  });

  describe('registration closing', () => {
    it('says nothing about a round whose gate has already shut', async () => {
      prisma.registrationRound.findMany.mockResolvedValueOnce([closingSoon]);
      phases.resolveMany.mockResolvedValueOnce(
        new Map([[closingSoon.id, RoundPhase.RECONCILING]]),
      );

      await service.run();

      expect(notifications.studentsWithoutGroupIn).not.toHaveBeenCalled();
      expect(sent()).toHaveLength(0);
    });

    it('keys each notice to the deadline, so an extension is heard again', async () => {
      prisma.registrationRound.findMany.mockResolvedValueOnce([closingSoon]);
      notifications.studentsWithoutGroupIn.mockResolvedValueOnce([340]);

      await service.run();

      const [notice] = sent().filter(
        (one) => one.type === NotificationType.REGISTRATION_CLOSING_SOON,
      );

      expect(notice.dedupeKey).toBe(
        `REGISTRATION_CLOSING_SOON:round=12:end=${closingSoon.registrationEnd.toISOString()}:user=340`,
      );
    });
  });

  describe('reports due', () => {
    it('asks only for groups that have handed in nothing of that kind', async () => {
      prisma.registrationRound.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 12,
            midtermDueAt: new Date('2026-08-22T00:00:00.000Z'),
            finalDueAt: null,
          },
        ]);

      await service.run();

      expect(prisma.registrationGroup.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            topic: { roundId: 12 },
            submissions: {
              none: { submissionType: SubmissionType.MIDTERM },
            },
          }) as unknown,
        }),
      );
    });
  });
});
