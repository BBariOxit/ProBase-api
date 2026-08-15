-- Drops bộ môn entirely.
--
-- The table grouped lecturers and majors but no business rule ever read it:
-- topic registration, proposals and grading are all open across the faculty.
-- Its only consumer was one report (SV per bộ môn), which is out of scope. A
-- flat list of chuyên ngành is the whole hierarchy the system needs.

-- DropForeignKey
ALTER TABLE "lecturer_profiles" DROP CONSTRAINT "lecturer_profiles_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "majors" DROP CONSTRAINT "majors_departmentId_fkey";

-- AlterTable
ALTER TABLE "lecturer_profiles" DROP COLUMN "departmentId";

-- AlterTable
ALTER TABLE "majors" DROP COLUMN "departmentId";

-- DropTable
DROP TABLE "departments";
