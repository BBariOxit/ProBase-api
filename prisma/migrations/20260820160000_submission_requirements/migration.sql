-- ─────────────────────────────────────────────────────────
-- What a group hands in becomes a list the faculty office declares, instead of
-- three values baked into an enum.
--
-- The enum was wrong in two ways at once. It mixed *when* something is due with
-- *what* it is — MIDTERM and FINAL are moments, SOURCE_CODE is a document — so
-- the three were offered as if they were the same kind of choice. And it left
-- out the one thing a Vietnamese đồ án actually opens with, the đề cương, which
-- is its own gate rather than an early report.
--
-- The two due-date columns go with it. They could hold exactly two deadlines
-- and no names, which is the same limitation from the other side.
--
-- Dropping rather than migrating: `submissions` is empty and no round has ever
-- carried a due date. The NOT NULL column below proves the first of those — on
-- a database with rows in that table this migration fails loudly instead of
-- inventing a requirement for them to point at.
-- ─────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "submission_requirements" (
    "id" SERIAL NOT NULL,
    "roundId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submission_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "submission_requirements_roundId_name_key" ON "submission_requirements"("roundId", "name");

-- CreateIndex
CREATE INDEX "submission_requirements_roundId_sortOrder_idx" ON "submission_requirements"("roundId", "sortOrder");

-- AddForeignKey
ALTER TABLE "submission_requirements" ADD CONSTRAINT "submission_requirements_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "registration_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "registration_rounds" DROP COLUMN "finalDueAt",
DROP COLUMN "midtermDueAt";

-- DropIndex
DROP INDEX "submissions_groupId_submissionType_version_idx";

-- AlterTable
ALTER TABLE "submissions" DROP COLUMN "submissionType",
ADD COLUMN     "requirementId" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "submissions_groupId_requirementId_version_idx" ON "submissions"("groupId", "requirementId", "version");

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "submission_requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DropEnum
DROP TYPE "SubmissionType";
