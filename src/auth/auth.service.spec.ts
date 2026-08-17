import { HttpStatus, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

/**
 * bcrypt is a native addon, and its exports are not configurable — `jest.spyOn`
 * cannot redefine them. Wrapping the real implementation in a `jest.fn` keeps
 * the comparisons genuine (these tests are about which hash gets compared, so a
 * stub would only measure the stub) while making the calls inspectable.
 */
jest.mock('bcrypt', () => {
  const actual = jest.requireActual<typeof import('bcrypt')>('bcrypt');
  return {
    ...actual,
    // Annotated rather than passed straight through: `compare` is overloaded on
    // whether a callback is given, and the bare reference resolves to the
    // callback form, whose return type is void.
    compare: jest.fn((data: string, hash: string): Promise<boolean> =>
      actual.compare(data, hash),
    ),
  };
});

/** The comparison calls, typed so the assertions are not reaching into `any`. */
const compare = bcrypt.compare as unknown as jest.Mock<
  Promise<boolean>,
  [data: string, hash: string]
>;

/**
 * The password used by every fixture account, and its real hash.
 *
 * A real bcrypt hash rather than a stub, because the point of most of these
 * tests is which hash `login` reaches for — comparing against a mock would
 * measure the mock.
 */
const PASSWORD = 'Student@123';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 10);

/**
 * The one refusal every failed sign-in gets, named here because several tests
 * turn on it being the *same* refusal — an unknown address, a wrong password and
 * a deactivated account must not be distinguishable by what they say.
 */
const WRONG_CREDENTIALS = 'Email hoặc mật khẩu không đúng';

interface UserRow {
  id: number;
  email: string;
  password: string;
  role: string;
  isActive: boolean;
  mustChangePassword: boolean;
  failedPasswordCount: number;
  passwordRetryAfter: Date | null;
}

function userRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 1,
    email: '2212345@dlu.edu.vn',
    password: PASSWORD_HASH,
    role: 'STUDENT',
    isActive: true,
    mustChangePassword: false,
    failedPasswordCount: 0,
    passwordRetryAfter: null,
    ...overrides,
  };
}

describe('AuthService password backoff', () => {
  let service: AuthService;
  let findUnique: jest.Mock;
  let update: jest.Mock;

  beforeEach(async () => {
    findUnique = jest.fn();
    // Every `user.update` here stands in for one that returns the row, because
    // recordFailedPassword reads the incremented count back off it.
    update = jest.fn().mockResolvedValue({ failedPasswordCount: 1 });
    compare.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: { findUnique, update },
            refreshToken: {
              create: jest.fn(),
              deleteMany: jest.fn(),
              delete: jest.fn(),
              findUnique: jest.fn(),
            },
            auditLog: { create: jest.fn() },
          },
        },
        { provide: JwtService, useValue: { signAsync: jest.fn(() => 'jwt') } },
        { provide: MailService, useValue: { sendPasswordReset: jest.fn() } },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: () => 'test-refresh-secret',
            get: (_key: string, fallback?: string) => fallback ?? '30d',
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  /** The `data` payload of the nth `user.update` call, 0-indexed. */
  function writtenData(nth: number) {
    const calls = update.mock.calls as [
      {
        data: {
          failedPasswordCount?: number | { increment: number };
          passwordRetryAfter?: Date | null;
        };
      },
    ][];
    return calls[nth][0].data;
  }

  /**
   * Stands in for `RETURNING failedPasswordCount`, which is what the service
   * derives the delay from — the count it read before the increment is
   * deliberately not used.
   */
  function incrementYields(count: number) {
    update.mockResolvedValue({ failedPasswordCount: count });
  }

  describe('a wrong password', () => {
    it('advances the count with an atomic increment, not a computed value', async () => {
      findUnique.mockResolvedValue(userRow({ failedPasswordCount: 3 }));
      incrementYields(4);

      await expect(
        service.login({ email: '2212345@dlu.edu.vn', password: 'wrong' }),
      ).rejects.toThrow(WRONG_CREDENTIALS);

      // Writing a literal 4 here is what lets concurrent guesses collapse into
      // one: they would all have read 3.
      expect(writtenData(0).failedPasswordCount).toEqual({ increment: 1 });
    });

    it.each([
      [1, null],
      [2, null],
      [3, null],
      [4, 1_000],
      [5, 2_000],
      [6, 4_000],
      [7, 8_000],
      // 2 ** 3997 is Infinity, and Infinity must land on the cap rather than
      // producing an Invalid Date that would never expire.
      [4_001, 30_000],
    ])(
      'failure number %i owes a delay of %s ms',
      async (failures, expectedDelayMs) => {
        findUnique.mockResolvedValue(
          userRow({ failedPasswordCount: failures - 1 }),
        );
        incrementYields(failures);
        const start = Date.now();

        await expect(
          service.login({ email: '2212345@dlu.edu.vn', password: 'wrong' }),
        ).rejects.toThrow(WRONG_CREDENTIALS);

        if (expectedDelayMs === null) {
          // No delay owed means no second write at all.
          expect(update).toHaveBeenCalledTimes(1);
          return;
        }

        expect(update).toHaveBeenCalledTimes(2);
        // Compared as a window, not an instant: the delay is measured from
        // whenever the service happened to run.
        const delay = writtenData(1).passwordRetryAfter!.getTime() - start;
        expect(delay).toBeGreaterThan(expectedDelayMs - 500);
        expect(delay).toBeLessThanOrEqual(expectedDelayMs + 500);
      },
    );
  });

  describe('while a delay is in force', () => {
    it('refuses with 429 and says how long is left', async () => {
      findUnique.mockResolvedValue(
        userRow({
          failedPasswordCount: 6,
          passwordRetryAfter: new Date(Date.now() + 8_000),
        }),
      );

      const attempt = service.login({
        email: '2212345@dlu.edu.vn',
        password: PASSWORD,
      });

      await expect(attempt).rejects.toBeInstanceOf(HttpException);
      await attempt.catch((err: HttpException) => {
        expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect(err.message).toContain('8 giây');
      });
    });

    it('refuses the correct password too, and does not extend the delay', async () => {
      findUnique.mockResolvedValue(
        userRow({
          failedPasswordCount: 6,
          passwordRetryAfter: new Date(Date.now() + 8_000),
        }),
      );

      await expect(
        service.login({ email: '2212345@dlu.edu.vn', password: PASSWORD }),
      ).rejects.toBeInstanceOf(HttpException);

      // Refusing early must not count as another failure — otherwise a client
      // that retries on its own would push its own delay to the cap.
      expect(update).not.toHaveBeenCalled();
    });

    it('lets the account through once the delay has passed', async () => {
      findUnique.mockResolvedValue(
        userRow({
          failedPasswordCount: 6,
          passwordRetryAfter: new Date(Date.now() - 1),
        }),
      );

      await expect(
        service.login({ email: '2212345@dlu.edu.vn', password: PASSWORD }),
      ).resolves.toMatchObject({ user: { email: '2212345@dlu.edu.vn' } });
    });
  });

  describe('a correct password', () => {
    it('clears the count and the delay', async () => {
      findUnique.mockResolvedValue(
        userRow({
          failedPasswordCount: 5,
          passwordRetryAfter: new Date(Date.now() - 1_000),
        }),
      );

      await service.login({ email: '2212345@dlu.edu.vn', password: PASSWORD });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { failedPasswordCount: 0, passwordRetryAfter: null },
        }),
      );
    });

    it('writes nothing when there was nothing to clear', async () => {
      findUnique.mockResolvedValue(userRow());

      await service.login({ email: '2212345@dlu.edu.vn', password: PASSWORD });

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('an address that holds no account', () => {
    it('still compares a password, so the two paths cost the same', async () => {
      findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@dlu.edu.vn', password: PASSWORD }),
      ).rejects.toThrow(WRONG_CREDENTIALS);

      // The claim under test is that the unknown-address path does the same
      // bcrypt work as the known one; skipping it is what makes the response
      // measurably faster and turns latency into an account-exists oracle.
      expect(compare).toHaveBeenCalledTimes(1);
    });

    it('records nothing, because there is no account to protect', async () => {
      findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@dlu.edu.vn', password: PASSWORD }),
      ).rejects.toThrow(WRONG_CREDENTIALS);

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('a deactivated account', () => {
    it('is refused with the same message as an unknown address', async () => {
      findUnique.mockResolvedValue(userRow({ isActive: false }));

      await expect(
        service.login({ email: '2212345@dlu.edu.vn', password: PASSWORD }),
      ).rejects.toThrow(WRONG_CREDENTIALS);
    });

    it('does not compare against its own stored hash', async () => {
      findUnique.mockResolvedValue(userRow({ isActive: false }));

      await expect(
        service.login({ email: '2212345@dlu.edu.vn', password: PASSWORD }),
      ).rejects.toThrow(WRONG_CREDENTIALS);

      // Comparing against the real hash would answer correctly and take the
      // success path's time; the sentinel keeps both wrong and constant.
      expect(compare).toHaveBeenCalledTimes(1);
      expect(compare.mock.calls[0][1]).not.toBe(PASSWORD_HASH);
    });
  });
});
