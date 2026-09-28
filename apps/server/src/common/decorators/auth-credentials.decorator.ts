import { SetMetadata } from '@nestjs/common';
import { AuthCredentialPolicy } from '../auth/auth-credential-policy';

export const AUTH_CREDENTIAL_POLICY = 'authCredentialPolicy';

export const AuthCredentials = (policy: AuthCredentialPolicy) =>
  SetMetadata(AUTH_CREDENTIAL_POLICY, policy);
