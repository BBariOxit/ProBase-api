import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private readonly refreshSecret: string;
  private readonly refreshExpiresIn: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.refreshSecret = config.getOrThrow<string>('JWT_REFRESH_SECRET');
    this.refreshExpiresIn = config.get('JWT_REFRESH_EXPIRES_IN', '30d');
  }

  async register(dto: RegisterDto) {
    // Check duplicate email
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already in use');

    const hash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hash,
        role: dto.role,
      },
      select: { id: true, email: true, role: true, createdAt: true },
    });

    return { message: 'Registered successfully', user };
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
      user: { id: user.id, email: user.email, role: user.role },
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

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hash },
    });

    return { message: 'Password changed successfully' };
  }

  // ── Private helpers ──────────────────────────────────────

  private async generateTokenPair(userId: number, email: string, role: string) {
    const jwtPayload = { sub: userId, email, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(jwtPayload),
      this.jwt.signAsync(jwtPayload, {
        secret: this.refreshSecret,
        expiresIn: this.refreshExpiresIn,
      }),
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
