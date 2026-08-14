import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

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
const DEMO_STUDENT_EMAIL = (
  process.env.SEED_STUDENT_EMAIL ?? 'sv001@probase.dev'
).toLowerCase();
const DEMO_STUDENT_PASSWORD =
  process.env.SEED_STUDENT_PASSWORD ?? 'Student@123';

// The whole system serves one faculty (the admin role is "Giáo vụ Khoa"), so
// `departments` are the bộ môn inside Khoa CNTT — not faculties of a
// university. Swap these for your faculty's real divisions.
const DEPARTMENTS = [
  { code: 'CNPM', name: 'Bộ môn Công nghệ Phần mềm' },
  { code: 'HTTT', name: 'Bộ môn Hệ thống Thông tin' },
  { code: 'KHMT', name: 'Bộ môn Khoa học Máy tính' },
  { code: 'MMT', name: 'Bộ môn Mạng máy tính và Truyền thông' },
  { code: 'ATTT', name: 'Bộ môn An toàn Thông tin' },
];

// Chuyên ngành, each owned by one bộ môn. Codes only need to be unique within
// their own table, so a chuyên ngành may share a code with its bộ môn.
const MAJORS = [
  { code: 'KTPM', name: 'Kỹ thuật Phần mềm', department: 'CNPM' },
  { code: 'HTTT', name: 'Hệ thống Thông tin', department: 'HTTT' },
  { code: 'KHMT', name: 'Khoa học Máy tính', department: 'KHMT' },
  { code: 'TTNT', name: 'Trí tuệ Nhân tạo', department: 'KHMT' },
  { code: 'MMT', name: 'Mạng máy tính và Truyền thông', department: 'MMT' },
  { code: 'ATTT', name: 'An toàn Thông tin', department: 'ATTT' },
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

  // Master data first — majors need a department, and bulk import resolves
  // majorCode/departmentCode against these tables.
  const departmentIdByCode = new Map<string, number>();
  for (const dept of DEPARTMENTS) {
    const saved = await prisma.department.upsert({
      where: { code: dept.code },
      create: dept,
      update: { name: dept.name },
    });
    departmentIdByCode.set(saved.code, saved.id);
  }
  console.log(`  departments: ${DEPARTMENTS.length}`);

  const majorIdByCode = new Map<string, number>();
  for (const major of MAJORS) {
    const departmentId = departmentIdByCode.get(major.department);
    if (departmentId === undefined) {
      throw new Error(`Major ${major.code} references unknown department`);
    }

    const saved = await prisma.major.upsert({
      where: { code: major.code },
      create: { code: major.code, name: major.name, departmentId },
      update: { name: major.name, departmentId },
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
          studentCode: 'SV001',
          fullName: 'Nguyễn Văn A',
          class: 'D21CQCN01',
          cohort: '2021',
          majorId: majorIdByCode.get('KTPM'),
        },
      },
    },
    update: {},
  });
  console.log(`  demo student: ${demoStudent.email} (mustChangePassword)`);

  console.log('\nLogin with:');
  console.log(`  ADMIN    ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`  STUDENT  ${DEMO_STUDENT_EMAIL} / ${DEMO_STUDENT_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
