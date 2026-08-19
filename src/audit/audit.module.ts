import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Read-only, and exports no provider.
 *
 * Entries are written by whichever service performed the action, inside the
 * transaction that performed it — an entry recorded outside that transaction can
 * survive a rollback or be lost while the change commits, and either way the log
 * stops being evidence. `recordAudit` in this folder is the shared shape for
 * writing one, and it takes the transaction client as its first argument so the
 * correct call is the only one that compiles. It is deliberately a function
 * rather than a provider: an injectable would be reachable from anywhere,
 * including outside a transaction.
 */
@Module({
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
