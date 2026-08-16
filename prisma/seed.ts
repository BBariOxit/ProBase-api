import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { cohortFromStudentCode } from '../src/users/student-code.util';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

// Same driver adapter PrismaService uses — Prisma 7 has no implicit datasource.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

// Every account here is admin-provisioned, matching how real accounts are
// created — there is no self-registration path for ADMIN, so without this seed
// the API has no way to produce its own first administrator.
const ADMIN_EMAIL = (
  process.env.SEED_ADMIN_EMAIL ?? 'admin@probase.dev'
).toLowerCase();
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';

// A fixture for building the forced-password-change screen. Bulk import mails
// a random temp password, which is useless while developing a UI — this account
// carries mustChangePassword with a password you already know.
// The address is the student code plus the domain, as it is at the university:
// cohort is derived from those first two digits, so a fixture like sv001@ would
// not survive its own validation rules.
const DEMO_STUDENT_CODE = process.env.SEED_STUDENT_CODE ?? '2212345';
const DEMO_STUDENT_EMAIL = (
  process.env.SEED_STUDENT_EMAIL ?? `${DEMO_STUDENT_CODE}@dlu.edu.vn`
).toLowerCase();
const DEMO_STUDENT_PASSWORD =
  process.env.SEED_STUDENT_PASSWORD ?? 'Student@123';

// Two lecturers, not one. A single lecturer cannot exercise the rule that
// matters most on topics — that owning a topic, rather than merely holding the
// LECTURER role, is what permits editing it — and the council and reviewer
// features later need more than one lecturer to assign anyway.
const DEMO_LECTURER_PASSWORD =
  process.env.SEED_LECTURER_PASSWORD ?? 'Lecturer@123';
const DEMO_LECTURERS = [
  {
    email: 'gv001@probase.dev',
    lecturerCode: 'GV001',
    fullName: 'Trần Thị B',
    academicTitle: 'TS',
    researchInterests: 'Kỹ thuật phần mềm, kiểm thử tự động',
  },
  {
    email: 'gv002@probase.dev',
    lecturerCode: 'GV002',
    fullName: 'Lê Văn C',
    academicTitle: 'ThS',
    researchInterests: 'Hệ thống thông tin, cơ sở dữ liệu',
  },
];

// Chuyên ngành — a flat list. Swap these for your faculty's real ones.
const MAJORS = [
  { code: 'KTPM', name: 'Kỹ thuật Phần mềm' },
  { code: 'HTTT', name: 'Hệ thống Thông tin' },
  { code: 'KHMT', name: 'Khoa học Máy tính' },
  { code: 'TTNT', name: 'Trí tuệ Nhân tạo' },
  { code: 'MMT', name: 'Mạng máy tính và Truyền thông' },
  { code: 'ATTT', name: 'An toàn Thông tin' },
];

const PROJECT_TYPES = [
  { code: 'DACS', name: 'Đồ án Cơ sở' },
  { code: 'DACN', name: 'Đồ án Chuyên ngành' },
  { code: 'DATN', name: 'Đồ án Tốt nghiệp' },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY_MS);

async function main() {
  console.log('Seeding…');

  // Master data first — bulk import resolves majorCode against this table.
  const majorIdByCode = new Map<string, number>();
  for (const major of MAJORS) {
    const saved = await prisma.major.upsert({
      where: { code: major.code },
      create: major,
      update: { name: major.name },
    });
    majorIdByCode.set(saved.code, saved.id);
  }
  console.log(`  majors: ${MAJORS.length}`);

  for (const type of PROJECT_TYPES) {
    await prisma.projectType.upsert({
      where: { code: type.code },
      create: type,
      update: { name: type.name },
    });
  }
  console.log(`  project types: ${PROJECT_TYPES.length}`);

  // Dates are relative to the run so the registration window is open right
  // now — a seeded semester that closed last month tests nothing.
  const month = new Date().getMonth();
  const academicYear =
    month >= 7 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const semesterCode = `HK1-${academicYear}-${academicYear + 1}`;

  await prisma.semester.upsert({
    where: { code: semesterCode },
    create: {
      code: semesterCode,
      name: `Học kỳ 1 năm học ${academicYear}-${academicYear + 1}`,
      startDate: daysFromNow(-30),
      endDate: daysFromNow(120),
      registrationStart: daysFromNow(-7),
      registrationEnd: daysFromNow(21),
      gradeSubmissionDeadline: daysFromNow(110),
      isActive: true,
    },
    update: { isActive: true },
  });
  console.log(`  semester: ${semesterCode} (registration open)`);

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    create: {
      email: ADMIN_EMAIL,
      password: await bcrypt.hash(ADMIN_PASSWORD, 10),
      role: 'ADMIN',
      // The bootstrap admin is the one account nobody can hand a temp
      // password to, so it starts ready to use.
      mustChangePassword: false,
    },
    update: {},
  });
  console.log(`  admin: ${admin.email}`);

  // Created the same way UsersService does it: account and profile together,
  // never a profile-less User.
  const demoStudent = await prisma.user.upsert({
    where: { email: DEMO_STUDENT_EMAIL },
    create: {
      email: DEMO_STUDENT_EMAIL,
      password: await bcrypt.hash(DEMO_STUDENT_PASSWORD, 10),
      role: 'STUDENT',
      mustChangePassword: true,
      studentProfile: {
        create: {
          studentCode: DEMO_STUDENT_CODE,
          fullName: 'Nguyễn Văn A',
          class: 'CTK46',
          // Derived from the code, exactly as the import and create paths do
          // it — the seed must not be the one place that sets it by hand.
          cohort: cohortFromStudentCode(DEMO_STUDENT_CODE)!,
          majorId: majorIdByCode.get('KTPM'),
        },
      },
    },
    update: {},
  });
  console.log(`  demo student: ${demoStudent.email} (mustChangePassword)`);

  // Ready to use rather than mustChangePassword: these exist to drive the
  // topic screens, and a forced password change on every reseed only gets in
  // the way of that.
  const lecturerPassword = await bcrypt.hash(DEMO_LECTURER_PASSWORD, 10);
  for (const lecturer of DEMO_LECTURERS) {
    const { email, ...profile } = lecturer;
    await prisma.user.upsert({
      where: { email },
      create: {
        email,
        password: lecturerPassword,
        role: 'LECTURER',
        mustChangePassword: false,
        lecturerProfile: { create: profile },
      },
      update: {},
    });
  }
  console.log(`  demo lecturers: ${DEMO_LECTURERS.length}`);

  console.log('\nLogin with:');
  console.log(`  ADMIN     ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`  STUDENT   ${DEMO_STUDENT_EMAIL} / ${DEMO_STUDENT_PASSWORD}`);
  for (const { email } of DEMO_LECTURERS) {
    console.log(`  LECTURER  ${email} / ${DEMO_LECTURER_PASSWORD}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
