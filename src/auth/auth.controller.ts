import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { GetUser } from './decorators/get-user.decorator';
import { Public } from './decorators/public.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

/**
 * Five attempts a minute per IP on anything that takes a credential.
 *
 * A password policy raises the cost of each guess; a rate limit caps how many
 * guesses are on offer. Without it, requiring eight characters just means an
 * attacker needs a slightly longer list. Genuine users do not sign in five
 * times a minute, so the ceiling is invisible to them.
 */
const CREDENTIAL_RATE_LIMIT = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle(CREDENTIAL_RATE_LIMIT)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // Rotation means a stolen refresh token is worth one use; the limit stops it
  // being fed to the endpoint in bulk. A real client refreshes about four
  // times an hour.
  @Public()
  @Throttle(CREDENTIAL_RATE_LIMIT)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

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
  @Throttle(CREDENTIAL_RATE_LIMIT)
  @Patch('change-password')
  changePassword(
    @GetUser('id') userId: number,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, dto);
  }
}
