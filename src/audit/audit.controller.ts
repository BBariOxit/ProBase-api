import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditService } from './audit.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

/**
 * Admin only, at the class level.
 *
 * What this returns is a record of who did what to whom across the whole
 * faculty: which student was taken out of which group, which account failed to
 * sign in and how often, which round somebody reopened. It is exactly the sort
 * of thing that is fine for the office to read and nobody else, and there is no
 * per-row rule that could make it safe for anyone narrower — so the gate is on
 * the door rather than inside.
 */
@Roles('ADMIN')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  findAll(@Query() query: QueryAuditLogsDto) {
    return this.auditService.findAll(query);
  }

  /**
   * Declared before nothing — there is no `:id` route to be swallowed by, and
   * deliberately so: a single audit entry has no page of its own, because one
   * line of it out of context is the least useful way to read a log.
   */
  @Get('actions')
  actions() {
    return this.auditService.actions();
  }
}
