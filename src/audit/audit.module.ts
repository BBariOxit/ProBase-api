import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Read-only, and exports nothing. Entries are written by whichever service
 * performed the action, inside the transaction that performed it — a shared
 * "write an audit entry" helper would be a way to record a change outside the
 * transaction that made it, which is the one thing an audit log must never do.
 */
@Module({
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
