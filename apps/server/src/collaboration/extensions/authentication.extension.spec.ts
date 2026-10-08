import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { SpaceRole, UserRole } from '../../common/helpers/types/permission';
import { AuthenticationExtension } from './authentication.extension';

describe('AuthenticationExtension', () => {
  const createSubject = (role = UserRole.OWNER) => {
    const tokenService = {
      verifyJwt: jest.fn().mockResolvedValue({
        sub: 'user-1',
        workspaceId: 'workspace-1',
      }),
    };
    const userRepo = {
      findById: jest.fn().mockResolvedValue({
        id: 'user-1',
        role,
        workspaceId: 'workspace-1',
      }),
    };
    const pageRepo = {
      findById: jest.fn().mockResolvedValue({
        id: 'page-1',
        spaceId: 'space-1',
        workspaceId: 'workspace-1',
        deletedAt: null,
      }),
    };

    const spaceMemberRepo = {
      getUserSpaceRoles: jest.fn().mockResolvedValue([]),
    };
    const pagePermissionRepo = {
      canUserEditPage: jest.fn().mockResolvedValue({
        hasAnyRestriction: false,
        canAccess: true,
        canEdit: true,
      }),
    };
    const extension = new AuthenticationExtension(
      tokenService as any,
      userRepo as any,
      pageRepo as any,
      spaceMemberRepo as any,
      pagePermissionRepo as any,
    );
    return { extension, spaceMemberRepo, pagePermissionRepo, pageRepo };
  };

  const payload = (readOnly: boolean) => ({
    documentName: 'page.page-1',
    token: 'collaboration-token',
    requestParameters: new URLSearchParams({
      readOnly: String(readOnly),
    }),
    connectionConfig: {
      readOnly: false,
    },
  });

  it.each([UserRole.OWNER, UserRole.ADMIN])(
    'forces a %s connection into read-only mode when requested',
    async (role) => {
      const { extension } = createSubject(role);
      const data = payload(true);

      await extension.onAuthenticate(data as any);

      expect(data.connectionConfig.readOnly).toBe(true);
    },
  );

  it.each([UserRole.OWNER, UserRole.ADMIN])(
    'leaves edit-mode connections writable for %s without space membership',
    async (role) => {
      const { extension, spaceMemberRepo } = createSubject(role);
      const data = payload(false);

      await extension.onAuthenticate(data as any);

      expect(data.connectionConfig.readOnly).toBe(false);
      expect(spaceMemberRepo.getUserSpaceRoles).not.toHaveBeenCalled();
    },
  );

  it('preserves restricted-page access checks for workspace admins', async () => {
    const { extension, pagePermissionRepo } = createSubject(UserRole.ADMIN);
    pagePermissionRepo.canUserEditPage.mockResolvedValue({
      hasAnyRestriction: true,
      canAccess: false,
      canEdit: false,
    });
    await expect(
      extension.onAuthenticate(payload(false) as any),
    ).rejects.toThrow(UnauthorizedException);

    pagePermissionRepo.canUserEditPage.mockResolvedValue({
      hasAnyRestriction: true,
      canAccess: true,
      canEdit: false,
    });
    const data = payload(false);
    await extension.onAuthenticate(data as any);
    expect(data.connectionConfig.readOnly).toBe(true);
  });

  it('denies ordinary users without space membership', async () => {
    const { extension } = createSubject(UserRole.MEMBER);
    await expect(
      extension.onAuthenticate(payload(false) as any),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('keeps ordinary space readers read-only', async () => {
    const { extension, spaceMemberRepo } = createSubject(UserRole.MEMBER);
    spaceMemberRepo.getUserSpaceRoles.mockResolvedValue([
      { userId: 'user-1', role: SpaceRole.READER },
    ]);
    const data = payload(false);
    await extension.onAuthenticate(data as any);
    expect(data.connectionConfig.readOnly).toBe(true);
  });

  it.each([UserRole.OWNER, UserRole.ADMIN])(
    'denies %s collaboration outside the authenticated workspace',
    async (role) => {
      const { extension, pageRepo } = createSubject(role);
      pageRepo.findById.mockResolvedValue({
        id: 'page-1',
        spaceId: 'space-1',
        workspaceId: 'other-workspace',
        deletedAt: null,
      });
      await expect(
        extension.onAuthenticate(payload(false) as any),
      ).rejects.toThrow(NotFoundException);
    },
  );

  it('keeps deleted pages read-only for admins', async () => {
    const { extension, pageRepo } = createSubject(UserRole.ADMIN);
    pageRepo.findById.mockResolvedValue({
      id: 'page-1',
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
      deletedAt: new Date(),
    });
    const data = payload(false);
    await extension.onAuthenticate(data as any);
    expect(data.connectionConfig.readOnly).toBe(true);
  });
});
