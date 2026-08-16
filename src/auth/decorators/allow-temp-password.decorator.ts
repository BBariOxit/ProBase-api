import { SetMetadata } from '@nestjs/common';

export const ALLOW_TEMP_PASSWORD_KEY = 'allowTempPassword';

/**
 * Marks a route as reachable while the caller is still carrying a temporary
 * password. Only the few routes needed to finish replacing it belong here:
 * reading the session, changing the password, and signing out.
 */
export const AllowTempPassword = () =>
  SetMetadata(ALLOW_TEMP_PASSWORD_KEY, true);
