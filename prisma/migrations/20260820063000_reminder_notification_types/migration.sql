-- ─────────────────────────────────────────────────────────
-- Two notices raised by the clock rather than by somebody's action.
--
-- Separate values rather than the generic DEADLINE_REMINDER already in the
-- type, because the client routes on the value: a student told their gate is
-- closing needs the topic list, and one told a report is due needs the
-- submission screen. One value for both would leave the client guessing from
-- the wording.
--
-- Added in their own migration: PostgreSQL will not let a value be added and
-- used inside the same transaction, and Prisma runs one migration as one.
-- ─────────────────────────────────────────────────────────
ALTER TYPE "NotificationType" ADD VALUE 'REGISTRATION_CLOSING_SOON';
ALTER TYPE "NotificationType" ADD VALUE 'SUBMISSION_DUE_SOON';
