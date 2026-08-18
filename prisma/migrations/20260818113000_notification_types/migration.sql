-- ─────────────────────────────────────────────────────────
-- Notification types that match the model as it stands.
--
-- GROUP_INVITATION, GROUP_APPROVED and GROUP_REJECTED described the mechanism
-- that was removed: joining a group by invitation, and a lecturer signing off
-- each group. Nothing can raise them any more. In their place go the four
-- events registration actually produces — somebody joined, somebody was
-- removed, the group dissolved, the round reopened.
--
-- The whole type is rebuilt rather than having values added and old ones left
-- lying around, and this is the moment when that is free: no code has ever
-- written to `notifications`, so the table is empty. The USING cast below is
-- what proves it — on a database that did hold a dropped value it fails loudly
-- instead of quietly turning it into something else.
-- ─────────────────────────────────────────────────────────
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";

CREATE TYPE "NotificationType" AS ENUM (
  'PROPOSAL_ACCEPTED',
  'PROPOSAL_REJECTED',
  'GROUP_MEMBER_JOINED',
  'GROUP_MEMBER_REMOVED',
  'GROUP_DISBANDED',
  'ROUND_EXTENDED',
  'SUBMISSION_FEEDBACK',
  'GRADE_PUBLISHED',
  'DEADLINE_REMINDER'
);

ALTER TABLE "notifications"
  ALTER COLUMN "type" TYPE "NotificationType"
  USING ("type"::text::"NotificationType");

DROP TYPE "NotificationType_old";
