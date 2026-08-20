import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { LecturersModule } from './lecturers/lecturers.module';
import { MeModule } from './me/me.module';
import { MailModule } from './mail/mail.module';
import { MajorsModule } from './majors/majors.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectTypesModule } from './project-types/project-types.module';
import { ProposalsModule } from './proposals/proposals.module';
import { RegistrationModule } from './registration/registration.module';
import { RemindersModule } from './reminders/reminders.module';
import { ReportsModule } from './reports/reports.module';
import { RoundsModule } from './rounds/rounds.module';
import { SemestersModule } from './semesters/semesters.module';
import { StudentsModule } from './students/students.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { TopicsModule } from './topics/topics.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // One loose ceiling, applied to every route separately — the storage key is
    // hashed from the controller and handler name alongside the caller, so this
    // is 120 requests a minute per endpoint, not 120 across the API. Credential
    // endpoints override it per route with @Throttle; a second named bucket
    // would not work, because every configured throttler applies to every route.
    //
    // Counting is per IP and in-memory: it resets on restart and does not span
    // instances. That is why brute-force protection does not live here — it is
    // counted per account, in the database, by AuthService. What is left for
    // this is capping how hard one host can hammer one endpoint, which an IP
    // count does well and needs no durability.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
      // Nest's default is "ThrottlerException: Too Many Requests" — a framework
      // class name, in English, on a Vietnamese screen, telling nobody what to
      // do. The client used to paper over it with a canned string, which then
      // also overwrote the messages that did say something useful.
      errorMessage: 'Bạn gửi quá nhiều yêu cầu. Đợi một phút rồi thử lại.',
    }),
    // The clock the deadline reminders run on, and the only scheduled work in
    // the system. Everything else is worked out when somebody looks — which is
    // the right answer for state, and the wrong one for a notice, because the
    // reader who needs a reminder is the one not opening the app.
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    AuthModule,
    CloudinaryModule,
    LecturersModule,
    MajorsModule,
    MeModule,
    NotificationsModule,
    RoundsModule,
    SemestersModule,
    ProjectTypesModule,
    ProposalsModule,
    StudentsModule,
    SubmissionsModule,
    TopicsModule,
    RegistrationModule,
    RemindersModule,
    ReportsModule,
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
