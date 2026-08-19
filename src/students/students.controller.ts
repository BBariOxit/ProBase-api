import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { QueryStudentsDto } from './dto/query-students.dto';
import { StudentsService } from './students.service';

/**
 * The faculty's students, admin only — at the class level rather than per route.
 *
 * Every row here carries `note`, the office's private remark about a student.
 * There is no per-row rule that could make that safe for a narrower reader, so
 * the gate is on the door: a route added below inherits it rather than having to
 * remember it.
 */
@Roles('ADMIN')
@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Get()
  findAll(@Query() query: QueryStudentsDto) {
    return this.studentsService.findAll(query);
  }

  /**
   * The same list as a file, filtered the same way.
   *
   * Declared before nothing — there is no `:id` route to be swallowed by, and
   * that is deliberate: one student on their own has a profile screen already,
   * and a second way to read the same person is a second thing to keep in step.
   */
  @Get('export')
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @Header(
    'Content-Disposition',
    'attachment; filename="danh-sach-sinh-vien.xlsx"',
  )
  async export(@Query() query: QueryStudentsDto) {
    return new StreamableFile(await this.studentsService.exportAll(query));
  }
}
