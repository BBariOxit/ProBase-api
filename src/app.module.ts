import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { DepartmentsModule } from './departments/departments.module';
import { MajorsModule } from './majors/majors.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectTypesModule } from './project-types/project-types.module';
import { SemestersModule } from './semesters/semesters.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    DepartmentsModule,
    MajorsModule,
    SemestersModule,
    ProjectTypesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
