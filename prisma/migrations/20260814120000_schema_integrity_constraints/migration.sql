-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('PROPOSAL_ACCEPTED', 'PROPOSAL_REJECTED', 'GROUP_INVITATION', 'GROUP_APPROVED', 'GROUP_REJECTED', 'SUBMISSION_FEEDBACK', 'GRADE_PUBLISHED', 'DEADLINE_REMINDER');

-- AlterEnum
BEGIN;
CREATE TYPE "CouncilMemberRole_new" AS ENUM ('PRESIDENT', 'SECRETARY', 'MEMBER');
ALTER TABLE "council_members" ALTER COLUMN "councilRole" TYPE "CouncilMemberRole_new" USING ("councilRole"::text::"CouncilMemberRole_new");
ALTER TYPE "CouncilMemberRole" RENAME TO "CouncilMemberRole_old";
ALTER TYPE "CouncilMemberRole_new" RENAME TO "CouncilMemberRole";
DROP TYPE "public"."CouncilMemberRole_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "council_topics" DROP CONSTRAINT "council_topics_groupId_fkey";

-- DropForeignKey
ALTER TABLE "registration_group_members" DROP CONSTRAINT "registration_group_members_groupId_fkey";

-- DropForeignKey
ALTER TABLE "registration_groups" DROP CONSTRAINT "registration_groups_topicId_fkey";

-- DropForeignKey
ALTER TABLE "submissions" DROP CONSTRAINT "submissions_groupId_fkey";

-- AlterTable
ALTER TABLE "council_topic_grades" ADD COLUMN     "finalGrade" DOUBLE PRECISION,
ADD COLUMN     "finalisedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "targetId" INTEGER,
ADD COLUMN     "type" "NotificationType" NOT NULL;

-- AlterTable
ALTER TABLE "registration_group_members" ADD COLUMN     "semesterId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "semesters" ADD COLUMN     "councilWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
ADD COLUMN     "mentorWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
ADD COLUMN     "reviewerWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.3;

-- CreateIndex
CREATE UNIQUE INDEX "council_topics_groupId_topicId_key" ON "council_topics"("groupId", "topicId");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_createdAt_idx" ON "notifications"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "registration_group_members_studentId_semesterId_idx" ON "registration_group_members"("studentId", "semesterId");

-- CreateIndex
CREATE UNIQUE INDEX "registration_groups_id_topicId_key" ON "registration_groups"("id", "topicId");

-- CreateIndex
CREATE UNIQUE INDEX "registration_groups_id_semesterId_key" ON "registration_groups"("id", "semesterId");

-- CreateIndex
CREATE INDEX "submissions_topicId_idx" ON "submissions"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "topics_id_semesterId_key" ON "topics"("id", "semesterId");

-- AddForeignKey
ALTER TABLE "registration_groups" ADD CONSTRAINT "registration_groups_topicId_semesterId_fkey" FOREIGN KEY ("topicId", "semesterId") REFERENCES "topics"("id", "semesterId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_group_members" ADD CONSTRAINT "registration_group_members_groupId_semesterId_fkey" FOREIGN KEY ("groupId", "semesterId") REFERENCES "registration_groups"("id", "semesterId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_groupId_topicId_fkey" FOREIGN KEY ("groupId", "topicId") REFERENCES "registration_groups"("id", "topicId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "council_topics" ADD CONSTRAINT "council_topics_groupId_topicId_fkey" FOREIGN KEY ("groupId", "topicId") REFERENCES "registration_groups"("id", "topicId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────
-- Partial unique indexes. Prisma's schema language cannot express a WHERE
-- clause on an index, so these two rules are written by hand — they are the
-- point of this migration, not an afterthought.
-- ─────────────────────────────────────────────────────────

-- A student may be INVITED to as many groups as people care to invite them to,
-- but may hold only one ACCEPTED membership per semester. Nothing enforced this
-- before: the existing (groupId, studentId) key only stopped joining the *same*
-- group twice, leaving a student free to be accepted into five topics at once.
CREATE UNIQUE INDEX "registration_group_members_one_accepted_per_semester"
  ON "registration_group_members" ("studentId", "semesterId")
  WHERE "status" = 'ACCEPTED';

-- Many groups may SUBMIT to a topic and the lecturer approves one of them.
-- Nothing stopped a second group from also being approved, which would have
-- put two groups on one topic and broken the 1:1 council_topics mapping
-- downstream.
CREATE UNIQUE INDEX "registration_groups_one_approved_per_topic"
  ON "registration_groups" ("topicId")
  WHERE "status" = 'APPROVED';
