import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { TempPasswordGuard } from './guards/temp-password.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    // Password reset both sends the link and warns the owner afterwards.
    MailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        // Minutes, not days. Access tokens are bearer credentials that are
        // never checked against the database, so nothing can revoke one before
        // it expires — a long-lived access token means logging out, or an admin
        // deactivating an account, has no effect until it lapses. Keeping the
        // window short is the entire reason the refresh token exists.
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '15m') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    // Global guards, applied in this order — all routes require JWT auth
    // unless marked @Public(). TempPasswordGuard sits ahead of RolesGuard on
    // purpose: an account that has not finished its password change should be
    // told that, rather than being handed a role error that sends whoever is
    // debugging it looking in the wrong place.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TempPasswordGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
