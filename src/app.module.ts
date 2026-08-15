import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.module';
import { MajorsModule } from './majors/majors.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectTypesModule } from './project-types/project-types.module';
import { SemestersModule } from './semesters/semesters.module';
import { TopicsModule } from './topics/topics.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // One loose ceiling for the whole API. Credential endpoints tighten it per
    // route with @Throttle — a second named bucket would not work, because
    // every configured throttler applies to every route, so an `auth` bucket
    // of 5/min would throttle the entire API to five requests a minute.
    //
    // Counting is per IP and in-memory: it resets on restart and does not span
    // instances. Right-sized for now; a shared store is only needed once the
    // API runs as more than one process.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuthModule,
    MajorsModule,
    SemestersModule,
    ProjectTypesModule,
    TopicsModule,
    UsersModule,
    MailModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Registered here rather than in AuthModule so the ceiling covers every
    // route, including ones added later that nobody remembers to annotate.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
