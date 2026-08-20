import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { QueryReportDto } from './dto/query-report.dto';
import { ReportsExportService } from './reports-export.service';
import { ReportsService } from './reports.service';

/**
 * The faculty office's numbers, admin only — at the class level rather than per
 * route.
 *
 * Not because any single figure is a secret, but because together they are a
 * picture of the whole faculty: how many students one lecturer is carrying, how
 * many the office had to place by hand, which supervisors are behind on reading
 * reports. That is management information, and a route added below inherits the
 * gate rather than having to remember it.
 */
@Roles('ADMIN')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly exports: ReportsExportService,
  ) {}

  @Get()
  summary(@Query() query: QueryReportDto) {
    return this.reports.summary(query.semesterId);
  }

  /**
   * The same numbers as a workbook, one sheet per section.
   *
   * Built from the same call the screen reads, so the file cannot disagree with
   * what the office was looking at when they pressed the button.
   */
  @Get('export')
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @Header('Content-Disposition', 'attachment; filename="bao-cao-thong-ke.xlsx"')
  async export(@Query() query: QueryReportDto) {
    return new StreamableFile(await this.exports.workbook(query.semesterId));
  }
}
