import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { GetUser } from './decorators/get-user.decorator';
import { Public } from './decorators/public.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

/**
 * Five attempts a minute per IP, for endpoints where guessing is actually
 * feasible — a password is short enough to be worth trying repeatedly.
 *
 * A password policy raises the cost of one guess; this caps how many guesses
 * are on offer. Without it, requiring eight characters just means an attacker
 * needs a slightly longer list.
 *
 * Deliberately NOT applied to reset-password: its token is 32 random bytes, so
 * there is no guessing surface to defend and a tight limit would only punish
 * someone finishing a legitimate reset. The looser app-wide ceiling still
 * covers it.
 */
const GUESSABLE_SECRET_RATE_LIMIT = { default: { limit: 5, ttl: 60_000 } };

/**
 * Requesting a link is limited for a different reason: it sends mail. Left
 * open it is a way to flood someone's inbox and burn the provider quota. The
 * allowance is higher than for guessing because nothing is being guessed.
 */
const SEND_MAIL_RATE_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle(GUESSABLE_SECRET_RATE_LIMIT)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // A refresh token is a signed 256-bit value that rotates on every use, so it
  // is not guessable either — the app-wide ceiling is protection enough, and a
  // tighter one would trip on a user with several tabs open.
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  // ── Self-service password reset (FR_STU_01) ──────────────

  // This one sends mail, so an unthrottled caller could flood a stranger's
  // inbox and burn the provider quota at the same time.
  @Public()
  @Throttle(SEND_MAIL_RATE_LIMIT)
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  // Read-only check so the client can say "link expired" on arrival instead of
  // after the user has typed a new password twice.
  @Public()
  @Get('reset-password/:token')
  checkResetToken(@Param('token') token: string) {
    return this.authService.checkResetToken(token);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  // ── Session ──────────────────────────────────────────────

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@GetUser('id') userId: number) {
    return this.authService.logout(userId);
  }

  @Get('me')
  getMe(@GetUser('id') userId: number) {
    return this.authService.getMe(userId);
  }

  // Guessing `currentPassword` is a credential attack like any other, even
  // though the caller already holds a valid access token.
  @Throttle(GUESSABLE_SECRET_RATE_LIMIT)
  @Patch('change-password')
  changePassword(
    @GetUser('id') userId: number,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, dto);
  }
}
