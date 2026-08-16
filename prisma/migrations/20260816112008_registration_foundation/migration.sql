-- CreateEnum
CREATE TYPE "AllocationMode" AS ENUM ('FIRST_COME', 'PREFERENCE_ROUND');

-- AlterTable
ALTER TABLE "registration_groups" ADD COLUMN     "openForJoin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "semesters" ADD COLUMN     "allocationMode" "AllocationMode" NOT NULL DEFAULT 'FIRST_COME';

-- CreateTable
CREATE TABLE "semester_eligibilities" (
    "id" SERIAL NOT NULL,
    "semesterId" INTEGER NOT NULL,
    "projectTypeId" INTEGER NOT NULL,
    "cohort" TEXT NOT NULL,

    CONSTRAINT "semester_eligibilities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "semester_eligibilities_semesterId_cohort_idx" ON "semester_eligibilities"("semesterId", "cohort");

-- CreateIndex
CREATE UNIQUE INDEX "semester_eligibilities_semesterId_projectTypeId_cohort_key" ON "semester_eligibilities"("semesterId", "projectTypeId", "cohort");

-- AddForeignKey
ALTER TABLE "semester_eligibilities" ADD CONSTRAINT "semester_eligibilities_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "semesters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semester_eligibilities" ADD CONSTRAINT "semester_eligibilities_projectTypeId_fkey" FOREIGN KEY ("projectTypeId") REFERENCES "project_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────
-- Allocation model: from a contest to first-come.
--
-- Written by hand because Prisma's schema language cannot express a WHERE
-- clause on an index, and this swap is the point of the migration.
-- ─────────────────────────────────────────────────────────

-- The old rule let any number of groups SUBMIT to one topic so the lecturer
-- could pick a winner. Combined with "one accepted membership per student per
-- semester", that traps whoever loses: they hold exactly one entry at a time,
-- and by the time they learn they were not chosen the good topics are gone.
--
-- Widening the predicate to every status except REJECTED makes the first group
-- to touch a topic its owner, and the second one is refused by the database.
-- No counting, no locking, and correct even when a thousand students click the
-- same topic in the same second as the window opens. REJECTED sits outside the
-- index, so a cancelled or refused group returns its topic to the pool while
-- its history stays on the table.
DROP INDEX "registration_groups_one_approved_per_topic";

CREATE UNIQUE INDEX "registration_groups_one_live_per_topic"
  ON "registration_groups" ("topicId")
  WHERE "status" <> 'REJECTED';
