-- ─────────────────────────────────────────────────────────
-- Registration: free joining, held seats, and semester phases.
--
-- Two model changes land together because they are one decision. Invitations
-- are gone, so a student joins a group in one action; and per-group lecturer
-- approval is gone, so review happens once for the whole faculty after the
-- gate closes — which needs a phase to happen in.
-- ─────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "SemesterPhase" AS ENUM ('PREP', 'OPEN', 'RECONCILING', 'FINALIZED');

-- CreateEnum
CREATE TYPE "GroupJoinSource" AS ENUM ('SELF', 'LINK', 'ASSIGNED');

-- AlterTable
--
-- `status` now defaults to ACCEPTED. A member row is only written when somebody
-- has actually joined, so INVITED as a default described a state that no longer
-- occurs. The value stays in the enum: the partial unique index that keeps a
-- student to one group per semester is defined in terms of ACCEPTED, and
-- narrowing the enum would mean rewriting it for no gain.
--
-- `assignedById` references users rather than lecturer_profiles because the
-- faculty office places students, from an ADMIN account.
ALTER TABLE "registration_group_members" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedById" INTEGER,
ADD COLUMN     "joinSource" "GroupJoinSource" NOT NULL DEFAULT 'SELF',
ALTER COLUMN "status" SET DEFAULT 'ACCEPTED';

-- AlterTable
--
-- `openForJoin` flips from false to true. Under the old model a group assembled
-- itself by invitation, so seats were spoken for and closed was the honest
-- default; now free joining is the mechanism and the flag means only "we are
-- going with fewer than the topic allows".
--
-- Changing the default is free today because this table is empty — the module
-- that writes to it does not exist yet. Doing it after real registrations exist
-- would have meant deciding what the flag should say about groups that never
-- chose a value.
--
-- `holdUntil` is a deadline, not a state: it expires by itself, so nothing that
-- frees a seat — a member leaving, a group disbanding, an account being locked —
-- has to remember to reopen the topic.
ALTER TABLE "registration_groups" ADD COLUMN     "declaredSize" INTEGER,
ADD COLUMN     "holdUntil" TIMESTAMP(3),
ADD COLUMN     "joinCode" TEXT,
ALTER COLUMN "openForJoin" SET DEFAULT true;

-- AlterTable
ALTER TABLE "semesters" ADD COLUMN     "finalisedAt" TIMESTAMP(3),
ADD COLUMN     "finalisedById" INTEGER,
ADD COLUMN     "phase" "SemesterPhase" NOT NULL DEFAULT 'PREP';

-- AlterTable
ALTER TABLE "student_profiles" ADD COLUMN     "note" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "registration_groups_joinCode_key" ON "registration_groups"("joinCode");

-- AddForeignKey
ALTER TABLE "semesters" ADD CONSTRAINT "semesters_finalisedById_fkey" FOREIGN KEY ("finalisedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_group_members" ADD CONSTRAINT "registration_group_members_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────
-- Backfill: the one-time bridge from "phase implied by dates" to "phase stored".
--
-- Written by hand because the default of PREP is right for a semester created
-- from now on and wrong for every semester that already exists: a live semester
-- with its window open would land in PREP and have its gate shut underneath it.
-- Until this migration the dates were the only answer available, so reading the
-- phase off them is exactly the state the system was already in.
--
-- A semester past its end date becomes FINALIZED with no `finalisedById`,
-- because nobody pressed anything — this migration inferred it. That the author
-- is null says so, which is better than inventing one.
--
-- Note `now() AT TIME ZONE 'UTC'` rather than a bare `now()`. These columns are
-- `timestamp without time zone` and Prisma writes them as UTC, but comparing one
-- against `now()` (which carries a zone) makes Postgres reinterpret the stored
-- value as local time — so on a server set to anything but UTC the comparison is
-- silently off by the offset, and a semester near a boundary lands in the wrong
-- phase. Both sides are kept naive-UTC so the arithmetic matches how the value
-- was written.
-- ─────────────────────────────────────────────────────────
UPDATE "semesters" SET "phase" = (CASE
  WHEN (now() AT TIME ZONE 'UTC') >  "endDate"           THEN 'FINALIZED'
  WHEN (now() AT TIME ZONE 'UTC') <  "registrationStart" THEN 'PREP'
  WHEN (now() AT TIME ZONE 'UTC') <= "registrationEnd"   THEN 'OPEN'
  ELSE 'RECONCILING'
END)::"SemesterPhase";
