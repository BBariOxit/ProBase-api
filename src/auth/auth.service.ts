import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

/** FR_STU_01: the reset link is valid for fifteen minutes and one use. */
const RESET_TOKEN_TTL_MINUTES = 15;

/**
 * Returned to every caller of forgotPassword, whether or not the address
 * exists. Telling an unknown address apart from a known one would turn the
 * endpoint into a list of who holds an account here.
 */
const FORGOT_PASSWORD_REPLY = {
  message:
    'Nếu email tồn tại trong hệ thống, hướng dẫn đặt lại mật khẩu đã được gửi.',
};

@Injectable()
export class AuthService {
  private readonly refreshSecret: string;
  private readonly refreshExpiresIn: string;
  private readonly frontendUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    this.refreshSecret = config.getOrThrow<string>('JWT_REFRESH_SECRET');
    this.refreshExpiresIn = config.get('JWT_REFRESH_EXPIRES_IN', '30d');
    this.frontendUrl = config.get('FRONTEND_URL', 'http://localhost:3000');
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user || !user.isActive)
      throw new UnauthorizedException('Invalid credentials');

    const passwordMatch = await bcrypt.compare(dto.password, user.password);
    if (!passwordMatch) throw new UnauthorizedException('Invalid credentials');

    const tokens = await this.generateTokenPair(user.id, user.email, user.role);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  async refreshTokens(refreshToken: string) {
    // Verify the refresh token JWT
    let payload: { sub: number; email: string; role: string };
    try {
      payload = await this.jwt.verifyAsync<{
        sub: number;
        email: string;
        role: string;
      }>(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Check the token hash exists in DB
    const tokenHash = this.hashToken(refreshToken);
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!storedToken || storedToken.expiresAt < new Date()) {
      // If token was found but expired, clean it up
      if (storedToken) {
        await this.prisma.refreshToken.delete({
          where: { id: storedToken.id },
        });
      }
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Delete the old token (rotation)
    await this.prisma.refreshToken.delete({ where: { id: storedToken.id } });

    // Generate new token pair
    const tokens = await this.generateTokenPair(
      payload.sub,
      payload.email,
      payload.role,
    );

    return tokens;
  }

  async logout(userId: number) {
    // Delete all refresh tokens for this user
    await this.prisma.refreshToken.deleteMany({
      where: { userId },
    });

    return { message: 'Logged out successfully' };
  }

  async getMe(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        // Login returns this too, but a client that reloads has only /auth/me
        // to rebuild its session from — without it here, refreshing the page
        // silently escapes the forced password-change screen.
        mustChangePassword: true,
        createdAt: true,
        updatedAt: true,
        studentProfile: true,
        lecturerProfile: true,
      },
    });

    if (!user || !user.isActive)
      throw new UnauthorizedException('User not found or inactive');

    return user;
  }

  async changePassword(userId: number, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) throw new UnauthorizedException('User not found');

    const passwordMatch = await bcrypt.compare(
      dto.currentPassword,
      user.password,
    );
    if (!passwordMatch)
      throw new BadRequestException('Current password is incorrect');

    const hash = await bcrypt.hash(dto.newPassword, 10);

    // Update password and clear the force-change flag in one query
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hash, mustChangePassword: false },
    });

    // Revoke all existing refresh tokens so old sessions are invalidated
    await this.prisma.refreshToken.deleteMany({ where: { userId } });

    // Issue a fresh token pair — user stays logged in seamlessly
    const tokens = await this.generateTokenPair(userId, user.email, user.role);

    return {
      message: 'Password changed successfully',
      ...tokens,
    };
  }

  // ── Self-service password reset (FR_STU_01) ──────────────

  /**
   * Always resolves the same reply, and does so before any email is sent.
   *
   * Returning early matters as much as the wording: doing the database write
   * and the Brevo call inline would make a known address measurably slower to
   * answer than an unknown one, and that timing difference is the answer the
   * uniform message is there to withhold.
   */
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        email: true,
        isActive: true,
        studentProfile: { select: { fullName: true } },
        lecturerProfile: { select: { fullName: true } },
      },
    });

    // A deactivated account is not a route back in, but saying so would leak.
    if (!user || !user.isActive) return FORGOT_PASSWORD_REPLY;

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000,
    );

    // Supersede any link already outstanding: requesting five resets should
    // leave one way in, not five.
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: this.hashToken(token), expiresAt },
      }),
    ]);

    await this.recordAudit(user.id, 'REQUEST_PASSWORD_RESET', user.id);

    const fullName =
      user.studentProfile?.fullName ?? user.lecturerProfile?.fullName;

    void this.mail.sendPasswordResetLink({
      to: user.email,
      fullName,
      resetUrl: `${this.frontendUrl}/reset-password?token=${token}`,
      expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
    });

    return FORGOT_PASSWORD_REPLY;
  }

  /**
   * Lets the client find out a link is dead before asking for a new password,
   * rather than after the user has typed one twice.
   */
  async checkResetToken(token: string) {
    const record = await this.findLiveResetToken(token);
    return { valid: record !== null };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const record = await this.findLiveResetToken(dto.token);
    if (!record) {
      throw new BadRequestException(
        'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn',
      );
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        // Not mustChangePassword: the user has just chosen this password
        // themselves, so demanding another change would be noise.
        data: { password: passwordHash, mustChangePassword: false },
      }),
      // Spend the link, and drop any sibling.
      this.prisma.passwordResetToken.deleteMany({
        where: { userId: record.userId },
      }),
      // People reset because they suspect someone else is inside the account.
      // Leaving existing sessions alive would defeat the entire exercise.
      this.prisma.refreshToken.deleteMany({ where: { userId: record.userId } }),
    ]);

    await this.recordAudit(record.userId, 'RESET_PASSWORD', record.userId);

    const fullName =
      record.user.studentProfile?.fullName ??
      record.user.lecturerProfile?.fullName;

    void this.mail.sendPasswordChangedNotice({
      to: record.user.email,
      fullName,
      changedAt: new Date(),
    });

    return { message: 'Đặt lại mật khẩu thành công' };
  }

  // ── Private helpers ──────────────────────────────────────

  /** Resolves a raw token to its unexpired row, or null. */
  private async findLiveResetToken(token: string) {
    if (!token) return null;

    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: {
        user: {
          select: {
            email: true,
            isActive: true,
            studentProfile: { select: { fullName: true } },
            lecturerProfile: { select: { fullName: true } },
          },
        },
      },
    });

    if (!record || record.expiresAt < new Date() || !record.user.isActive) {
      return null;
    }
    return record;
  }

  /**
   * Password resets are exactly the sensitive action FR_SYS_03 wants recorded:
   * when someone reports a hijacked account, the question is whether a reset
   * happened and when. Logging must never be the reason an auth flow fails,
   * so a write that goes wrong is swallowed.
   */
  private async recordAudit(userId: number, action: string, targetId: number) {
    await this.prisma.auditLog
      .create({
        data: {
          userId,
          action,
          targetTable: 'users',
          targetId: String(targetId),
        },
      })
      .catch(() => undefined);
  }

  private async generateTokenPair(userId: number, email: string, role: string) {
    const jwtPayload = { sub: userId, email, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(jwtPayload),
      // `jti` is what keeps two refresh tokens for the same user distinct.
      // Everything else in the payload is fixed, and `iat` only has one-second
      // resolution, so two issues inside the same second produced a
      // byte-identical JWT — and therefore an identical tokenHash, which the
      // unique index rejected with a 500. Changing a password issues a pair
      // and the client immediately uses it, so that second is easy to hit.
      this.jwt.signAsync(
        { ...jwtPayload, jti: randomUUID() },
        {
          secret: this.refreshSecret,
          expiresIn: this.refreshExpiresIn as `${number}d`,
        },
      ),
    ]);

    // Store refresh token hash in DB
    const tokenHash = this.hashToken(refreshToken);
    const expiresAt = this.parseExpiresIn(this.refreshExpiresIn);

    await this.prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt },
    });

    return { accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseExpiresIn(expiresIn: string): Date {
    const match = /^(\d+)([smhd])$/.exec(expiresIn);
    if (!match) throw new Error(`Invalid expiresIn format: ${expiresIn}`);

    const value = parseInt(match[1], 10);
    const unit = match[2];

    const ms: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return new Date(Date.now() + value * ms[unit]);
  }
}
