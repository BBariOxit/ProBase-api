-- ─────────────────────────────────────────────────────────
-- When reports are due, and what stops a reminder being sent twice.
--
-- The two deadlines sit on the round, not the semester: Tốt nghiệp hands in
-- weeks before Cơ sở, and one pair of dates for the whole term cannot express
-- that. Both nullable — an office that has not announced a deadline has none,
-- and nothing is due or reminded until it does.
--
-- `dedupeKey` is what makes the reminder job safe to run again. Every run
-- re-derives its notices from the deadlines, so a run that never happened is
-- caught up by the next one — and without a key that same property would resend
-- every reminder every morning. Nullable and unique: notices raised by an
-- action leave it null, and Postgres allows any number of nulls in a unique
-- index, so two people joining a group still produce two notices.
-- ─────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "registration_rounds" ADD COLUMN     "finalDueAt" TIMESTAMP(3),
ADD COLUMN     "midtermDueAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "dedupeKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupeKey_key" ON "notifications"("dedupeKey");
