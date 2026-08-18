-- ─────────────────────────────────────────────────────────
-- Registration rounds: a semester crossed with a kind of project.
--
-- A faculty opens Cơ sở, Chuyên ngành and Tốt nghiệp in the same semester, for
-- three different intakes, and those three share no seat with one another. So
-- every question registration asks — is the gate open, how many places are
-- left, has allocation been settled — has one answer per kind of project and
-- none per semester. Asked of a whole semester the answers add up numbers that
-- cannot be added: an intake 30 places short plus another with 40 spare reads
-- as "10 spare", and the allocation desk then tells the office it need not open
-- more topics.
--
-- The window, the phase and the finalisation therefore move off `semesters` and
-- onto a round. What stays behind is what genuinely spans a term: its dates, the
-- grading deadline and the grade weights.
--
-- `semester_eligibilities` becomes `round_eligibilities`: the round already
-- carries the kind of project, so a row only names the intake. Declaring an
-- intake is what creates the round — the office fills in one thing, not two.
-- ─────────────────────────────────────────────────────────

-- CreateEnum
--
-- A fresh type rather than renaming `SemesterPhase` and adding a value to it.
-- Postgres will not let a value added to an enum be used later in the same
-- transaction, and a migration runs in one — so the backfill below could not
-- have referred to EXTENDED at all. The old type is dropped at the end, once
-- nothing is typed by it.
CREATE TYPE "RoundPhase" AS ENUM ('PREP', 'OPEN', 'RECONCILING', 'EXTENDED', 'FINALIZED');

-- CreateTable
CREATE TABLE "registration_rounds" (
    "id" SERIAL NOT NULL,
    "semesterId" INTEGER NOT NULL,
    "projectTypeId" INTEGER NOT NULL,
    "registrationStart" TIMESTAMP(3) NOT NULL,
    "registrationEnd" TIMESTAMP(3) NOT NULL,
    "phase" "RoundPhase" NOT NULL DEFAULT 'PREP',
    "allocationMode" "AllocationMode" NOT NULL DEFAULT 'FIRST_COME',
    "finalisedAt" TIMESTAMP(3),
    "finalisedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registration_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_eligibilities" (
    "id" SERIAL NOT NULL,
    "roundId" INTEGER NOT NULL,
    "cohort" TEXT NOT NULL,

    CONSTRAINT "round_eligibilities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "registration_rounds_semesterId_projectTypeId_key" ON "registration_rounds"("semesterId", "projectTypeId");

-- CreateIndex
--
-- The target of the composite foreign key from `topics`, so a topic cannot sit
-- in a round belonging to a different semester than the one it claims.
CREATE UNIQUE INDEX "registration_rounds_id_semesterId_key" ON "registration_rounds"("id", "semesterId");

-- CreateIndex
CREATE UNIQUE INDEX "round_eligibilities_roundId_cohort_key" ON "round_eligibilities"("roundId", "cohort");

-- AddForeignKey
ALTER TABLE "registration_rounds" ADD CONSTRAINT "registration_rounds_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "semesters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_rounds" ADD CONSTRAINT "registration_rounds_projectTypeId_fkey" FOREIGN KEY ("projectTypeId") REFERENCES "project_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_rounds" ADD CONSTRAINT "registration_rounds_finalisedById_fkey" FOREIGN KEY ("finalisedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_eligibilities" ADD CONSTRAINT "round_eligibilities_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "registration_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────
-- Backfill: one round per (semester, kind of project) that already exists.
--
-- The pairs come from the union of two tables, and taking either one alone
-- loses data. Only `semester_eligibilities` and a topic written for a kind of
-- project the office never declared is left with nothing to point at, which the
-- NOT NULL below would then reject. Only `topics` and a round the office
-- declared but nobody has written a topic for yet disappears, taking its
-- eligibility rows with it.
--
-- Window, phase and finalisation are copied down from the semester because
-- until this migration they were the only answer the system had. Every round of
-- a semester therefore starts life saying exactly what that semester said.
-- ─────────────────────────────────────────────────────────
INSERT INTO "registration_rounds" (
  "semesterId", "projectTypeId",
  "registrationStart", "registrationEnd",
  "phase", "allocationMode",
  "finalisedAt", "finalisedById",
  "createdAt", "updatedAt"
)
SELECT
  s."id", pair."projectTypeId",
  s."registrationStart", s."registrationEnd",
  s."phase"::text::"RoundPhase", s."allocationMode",
  s."finalisedAt", s."finalisedById",
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "semesters" s
JOIN (
  SELECT "semesterId", "projectTypeId" FROM "topics"
  UNION
  SELECT "semesterId", "projectTypeId" FROM "semester_eligibilities"
) pair ON pair."semesterId" = s."id";

INSERT INTO "round_eligibilities" ("roundId", "cohort")
SELECT r."id", e."cohort"
FROM "semester_eligibilities" e
JOIN "registration_rounds" r
  ON r."semesterId" = e."semesterId"
 AND r."projectTypeId" = e."projectTypeId";

-- ─────────────────────────────────────────────────────────
-- Topics point at a round instead of carrying the kind of project themselves.
--
-- Added nullable, filled from the rounds just written, and only then made NOT
-- NULL: the union above guarantees every existing topic has a row to match, and
-- the constraint is what proves it rather than a comment claiming it.
-- ─────────────────────────────────────────────────────────
ALTER TABLE "topics" ADD COLUMN "roundId" INTEGER;

UPDATE "topics" t
SET "roundId" = r."id"
FROM "registration_rounds" r
WHERE r."semesterId" = t."semesterId"
  AND r."projectTypeId" = t."projectTypeId";

ALTER TABLE "topics" ALTER COLUMN "roundId" SET NOT NULL;

ALTER TABLE "topics" DROP COLUMN "projectTypeId";

-- CreateIndex
CREATE INDEX "topics_roundId_idx" ON "topics"("roundId");

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_roundId_semesterId_fkey" FOREIGN KEY ("roundId", "semesterId") REFERENCES "registration_rounds"("id", "semesterId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────
-- What the semester no longer answers for.
-- ─────────────────────────────────────────────────────────
ALTER TABLE "semesters"
  DROP COLUMN "registrationStart",
  DROP COLUMN "registrationEnd",
  DROP COLUMN "phase",
  DROP COLUMN "allocationMode",
  DROP COLUMN "finalisedAt",
  DROP COLUMN "finalisedById";

DROP TABLE "semester_eligibilities";

DROP TYPE "SemesterPhase";
