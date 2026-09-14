import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Page } from '@akasha/db/types/entity.types';
import { ApiKeyRepo } from '@akasha/db/repos/api-key/api-key.repo';
import { PagePermissionRepo } from '@akasha/db/repos/page/page-permission.repo';
import type { AgentAccessContext } from '../../../common/auth/agent-access-context';
import { PageAccessService } from './page-access.service';

@Injectable()
export class AgentAccessService {
  constructor(
    private readonly apiKeyRepo: ApiKeyRepo,
    private readonly pagePermissionRepo: PagePermissionRepo,
    private readonly pageAccessService: PageAccessService,
  ) {}

  getBoundSpaceIds(context: AgentAccessContext): Promise<string[]> {
    return this.apiKeyRepo.findSpaceIdsByApiKeyId(context.apiKeyId);
  }

  async assertSpaceBound(
    context: AgentAccessContext,
    spaceId: string,
  ): Promise<void> {
    const boundSpaceIds = await this.getBoundSpaceIds(context);
    if (!boundSpaceIds.includes(spaceId)) {
      throw new ForbiddenException('Space is outside the Agent API key scope');
    }
  }

  async assertPageReadable(
    context: AgentAccessContext,
    page: Page,
  ): Promise<{ canEdit: boolean; hasRestriction: boolean }> {
    if (page.workspaceId !== context.workspace.id || page.deletedAt) {
      throw new ForbiddenException();
    }
    await this.assertSpaceBound(context, page.spaceId);

    const { hasAnyRestriction } = await this.pagePermissionRepo.canUserEditPage(
      context.agentUser.id,
      page.id,
    );
    if (!hasAnyRestriction) {
      return { canEdit: true, hasRestriction: false };
    }
    if (!context.delegatedUser) {
      throw new ForbiddenException();
    }

    await this.pageAccessService.validateCanView(page, context.delegatedUser);
    return { canEdit: false, hasRestriction: true };
  }

  async assertPageWritable(
    context: AgentAccessContext,
    page: Page,
  ): Promise<{ hasRestriction: false }> {
    if (page.workspaceId !== context.workspace.id || page.deletedAt) {
      throw new ForbiddenException();
    }
    await this.assertSpaceBound(context, page.spaceId);
    const { hasAnyRestriction } = await this.pagePermissionRepo.canUserEditPage(
      context.agentUser.id,
      page.id,
    );
    if (hasAnyRestriction) {
      throw new ForbiddenException(
        'Agent API keys cannot modify restricted pages',
      );
    }
    return { hasRestriction: false };
  }

  async assertCanCreate(
    context: AgentAccessContext,
    spaceId: string,
    parentPage?: Page,
  ): Promise<void> {
    await this.assertSpaceBound(context, spaceId);
    if (!parentPage) return;
    if (
      parentPage.workspaceId !== context.workspace.id ||
      parentPage.spaceId !== spaceId ||
      parentPage.deletedAt
    ) {
      throw new ForbiddenException();
    }
    await this.assertPageWritable(context, parentPage);
  }

  pagePermissionUserId(context: AgentAccessContext): string {
    return context.delegatedUser?.id ?? context.agentUser.id;
  }
}
