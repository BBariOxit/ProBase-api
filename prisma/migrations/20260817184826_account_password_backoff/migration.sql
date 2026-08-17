-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failedPasswordCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "passwordRetryAfter" TIMESTAMP(3);
