-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "feedbackAt" TIMESTAMP(3),
ADD COLUMN     "filePublicId" TEXT,
ADD COLUMN     "submittedById" INTEGER;

-- CreateIndex
CREATE INDEX "submissions_groupId_submissionType_version_idx" ON "submissions"("groupId", "submissionType", "version");

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "student_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
