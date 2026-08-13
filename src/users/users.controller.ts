import { Controller } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsersService } from './users.service';

@Roles('ADMIN')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}
}
