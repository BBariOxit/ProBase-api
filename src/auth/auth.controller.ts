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
import { AllowTempPassword } from './decorators/allow-temp-password.decorator';
import { GetUser } from './decorators/get-user.decorator';
import { Public } from './decorators/public.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

/**
 * A wide net, because the throttler counts by IP address and an IP address is
 * not a person.
 *
 * This used to be five a minute, which read as "five guesses per attacker" and
 * was in fact neither half of that. Students on campus wifi reach the API from
 * one shared address, so the five were split across everyone on the network —
 * the sixth person to sign in at nine in the morning was refused for something
 * a stranger did. An attacker, meanwhile, rents an address per guess and gets
 * five on each.
 *
 * Guessing is now held off where the count cannot be diluted or multiplied: on
 * the account itself, by the backoff in AuthService.login. What is left for this
 * ceiling is the job an IP count is genuinely good at — stopping one host from
 * burning the CPU, since every attempt here costs a deliberately slow bcrypt
 * comparison. Sixty a minute is far above what a person on a login form can
 * produce and far below what a flood needs.
 *
 * Deliberately NOT applied to reset-password: its token is 32 random bytes, so
 * there is no guessing surface to defend and a tight limit would only punish
 * someone finishing a legitimate reset. The app-wide ceiling still covers it.
 */
const CREDENTIAL_IP_CEILING = { default: { limit: 60, ttl: 60_000 } };

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
  @Throttle(CREDENTIAL_IP_CEILING)
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

  // Signing out has to stay reachable, or an account holding a temporary
  // password would have no way to end its own session.
  @AllowTempPassword()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@GetUser('id') userId: number) {
    return this.authService.logout(userId);
  }

  // The client reads mustChangePassword from here to decide where to send the
  // user, so blocking it would leave it unable to find that out.
  @AllowTempPassword()
  @Get('me')
  getMe(@GetUser('id') userId: number) {
    return this.authService.getMe(userId);
  }

  // Guessing `currentPassword` is a credential attack like any other, even
  // though the caller already holds a valid access token — but the guessing is
  // held off per account in the service, not by this ceiling. It matters here in
  // particular: at the start of a semester every admin-created account is sent
  // to this endpoint at once, so a tight per-IP count would refuse a whole
  // cohort of first-time sign-ins.
  @AllowTempPassword()
  @Throttle(CREDENTIAL_IP_CEILING)
  @Patch('change-password')
  changePassword(
    @GetUser('id') userId: number,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, dto);
  }
}
