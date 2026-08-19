import { Prisma } from '../../generated/prisma/client';

/** What one line of the trail records. */
export interface AuditEntry {
  /** The account that performed the action, never the one it happened to. */
  userId: number;
  /** SCREAMING_SNAKE, and its own name — the screen falls back to it verbatim. */
  action: string;
  targetTable: string;
  targetId: string | number;
  /** Whatever the caller decides is worth keeping. No fixed shape by design. */
  oldValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
}

/**
 * Writes one entry, and takes the transaction to write it in.
 *
 * The transaction client is the first parameter rather than optional, and that
 * is the whole point of this function existing: an audit entry recorded outside
 * the transaction that made the change can survive a rollback, or be lost while
 * the change commits. Either way the log stops being evidence. Requiring the
 * `tx` makes the correct call the only one that compiles.
 *
 * It is a plain function rather than an injectable service for the same reason
 * the audit module exports nothing: there is no configuration here and nothing
 * to stub, only a shape that every call site would otherwise retype slightly
 * differently.
 */
export function recordAudit(tx: Prisma.TransactionClient, entry: AuditEntry) {
  return tx.auditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      targetTable: entry.targetTable,
      targetId: String(entry.targetId),
      ...(entry.oldValue !== undefined && { oldValue: entry.oldValue }),
      ...(entry.newValue !== undefined && { newValue: entry.newValue }),
    },
  });
}
