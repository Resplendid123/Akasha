import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import {
  TemplateRepo,
  TemplateRow,
  TemplateSpaceFilter,
} from '@akasha/db/repos/template/template.repo';
import { PageRepo } from '@akasha/db/repos/page/page.repo';
import { SpaceMemberRepo } from '@akasha/db/repos/space/space-member.repo';
import { KyselyDB } from '@akasha/db/types/kysely.types';
import { executeTx } from '@akasha/db/utils';
import { Page, User, Workspace } from '@akasha/db/types/entity.types';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import { PageAccessService } from '../page/page-access/page-access.service';
import { PageService } from '../page/services/page.service';
import { isWorkspaceAdmin } from '../../common/helpers/types/permission';
import { jsonToNode, jsonToText } from '../../collaboration/collaboration.util';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import {
  CreateTemplateDto,
  ListTemplatesDto,
  UpdateTemplateDto,
  UseTemplateDto,
} from './dto/template.dto';
import { buildOutline, OutlineItem } from './template-outline';

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

/**
 * 对外返回的模板：
 * - spaceIds 只包含当前用户能访问的空间；
 * - otherSpaceCount 为用户看不到的已指定空间数（只用于展示"另有 N 个空间"）。
 */
export type TemplateView = Omit<TemplateRow, 'spaceIds'> & {
  spaceIds: string[];
  otherSpaceCount: number;
  canManage: boolean;
};
export type TemplateListItem = Omit<TemplateView, 'content'> & {
  outline: OutlineItem[];
};

interface Availability {
  allSpaces: boolean;
  spaceIds: string[];
}

@Injectable()
export class TemplateService {
  constructor(
    private readonly templateRepo: TemplateRepo,
    private readonly pageRepo: PageRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly pageAccessService: PageAccessService,
    private readonly pageService: PageService,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async list(user: User, workspace: Workspace, dto: ListTemplatesDto) {
    const userSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(user.id);
    const scope = dto.scope ?? 'all';

    const filter: TemplateSpaceFilter =
      scope === 'allSpaces'
        ? { mode: 'allSpaces' }
        : scope === 'space'
          ? { mode: 'assignedTo', spaceId: dto.spaceId }
          : scope === 'available'
            ? { mode: 'availableIn', spaceId: dto.spaceId }
            : { mode: 'accessible' };

    const result = await this.templateRepo.findTemplates(
      workspace.id,
      userSpaceIds,
      dto,
      filter,
      { includeContent: true },
    );

    return {
      ...result,
      items: result.items.map((row): TemplateListItem => {
        const { content, ...view } = this.toView(
          row as TemplateRow,
          user,
          workspace,
          userSpaceIds,
        );
        return { ...view, outline: buildOutline(content) };
      }),
    };
  }

  async getById(
    templateId: string,
    user: User,
    workspace: Workspace,
  ): Promise<TemplateView> {
    const { template, userSpaceIds } = await this.findVisibleOrThrow(
      templateId,
      user,
      workspace,
      { includeContent: true },
    );
    return this.toView(template, user, workspace, userSpaceIds);
  }

  async create(
    dto: CreateTemplateDto,
    user: User,
    workspace: Workspace,
  ): Promise<TemplateView> {
    if (dto.content && dto.sourcePageId) {
      throw new BadRequestException(
        'content and sourcePageId are mutually exclusive',
      );
    }

    // 未指定范围时默认"所有空间"
    const availability = this.normalizeAvailability(
      dto.allSpaces === undefined && dto.spaceIds === undefined
        ? { allSpaces: true }
        : dto,
    );
    await this.assertCanAssign(availability, [], user, workspace);

    let content: any = dto.content ?? EMPTY_DOC;
    if (dto.sourcePageId) {
      content = await this.readSourcePageContent(dto.sourcePageId, user, workspace);
    }
    const textContent = this.toText(content);

    const id = await executeTx(this.db, async (trx) => {
      const { id } = await this.templateRepo.insertTemplate(
        {
          title: dto.title,
          description: dto.description ?? null,
          icon: dto.icon ?? null,
          allSpaces: availability.allSpaces,
          content,
          textContent,
          workspaceId: workspace.id,
          creatorId: user.id,
          lastUpdatedById: user.id,
        },
        trx,
      );
      await this.templateRepo.setTemplateSpaces(id, availability.spaceIds, trx);
      return id;
    });

    this.auditService.log({
      event: AuditEvent.TEMPLATE_CREATED,
      resourceType: AuditResource.TEMPLATE,
      resourceId: id,
      changes: { after: { title: dto.title, ...availability } },
      metadata: dto.sourcePageId ? { sourcePageId: dto.sourcePageId } : undefined,
    });

    return this.getById(id, user, workspace);
  }

  async update(
    dto: UpdateTemplateDto,
    user: User,
    workspace: Workspace,
  ): Promise<TemplateView> {
    const { template, userSpaceIds } = await this.findVisibleOrThrow(
      dto.templateId,
      user,
      workspace,
    );
    this.assertCanManage(template, user, workspace);

    let nextAvailability: Availability | null = null;
    if (dto.allSpaces !== undefined || dto.spaceIds !== undefined) {
      const requested = this.normalizeAvailability({
        allSpaces: dto.allSpaces ?? template.allSpaces,
        spaceIds: dto.spaceIds ?? template.spaceIds,
      });
      // 用户看不到的已指定空间原样保留，避免一次保存把别人加的空间删掉
      const hidden = template.spaceIds.filter((id) => !userSpaceIds.includes(id));
      nextAvailability = requested.allSpaces
        ? requested
        : {
            allSpaces: false,
            spaceIds: [...new Set([...requested.spaceIds, ...hidden])],
          };
      await this.assertCanAssign(
        nextAvailability,
        template.allSpaces ? null : template.spaceIds,
        user,
        workspace,
      );
    }

    const patch: Record<string, any> = { lastUpdatedById: user.id };
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.icon !== undefined) patch.icon = dto.icon;
    if (nextAvailability) patch.allSpaces = nextAvailability.allSpaces;
    if (dto.content !== undefined) {
      patch.content = dto.content;
      patch.textContent = this.toText(dto.content);
    }

    await executeTx(this.db, async (trx) => {
      await this.templateRepo.updateTemplate(patch, template.id, workspace.id, trx);
      if (nextAvailability) {
        await this.templateRepo.setTemplateSpaces(
          template.id,
          nextAvailability.allSpaces ? [] : nextAvailability.spaceIds,
          trx,
        );
      }
    });

    const availabilityChanged =
      nextAvailability &&
      (nextAvailability.allSpaces !== template.allSpaces ||
        !sameSet(nextAvailability.spaceIds, template.spaceIds));
    this.auditService.log({
      event: AuditEvent.TEMPLATE_UPDATED,
      resourceType: AuditResource.TEMPLATE,
      resourceId: template.id,
      changes: availabilityChanged
        ? {
            before: { allSpaces: template.allSpaces, spaceIds: template.spaceIds },
            after: nextAvailability,
          }
        : undefined,
    });

    return this.getById(template.id, user, workspace);
  }

  async delete(templateId: string, user: User, workspace: Workspace) {
    const { template } = await this.findVisibleOrThrow(templateId, user, workspace);
    this.assertCanManage(template, user, workspace);

    await this.templateRepo.deleteTemplate(template.id, workspace.id);

    this.auditService.log({
      event: AuditEvent.TEMPLATE_DELETED,
      resourceType: AuditResource.TEMPLATE,
      resourceId: template.id,
      changes: { before: { title: template.title } },
    });
  }

  async use(dto: UseTemplateDto, user: User, workspace: Workspace) {
    const { template } = await this.findVisibleOrThrow(
      dto.templateId,
      user,
      workspace,
      { includeContent: true },
    );

    if (!template.allSpaces && !template.spaceIds.includes(dto.spaceId)) {
      throw new BadRequestException('Template is not available in this space');
    }

    if (dto.parentPageId) {
      const parent = await this.pageRepo.findById(dto.parentPageId);
      if (
        !parent ||
        parent.deletedAt ||
        parent.workspaceId !== workspace.id ||
        parent.spaceId !== dto.spaceId
      ) {
        throw new NotFoundException('Parent page not found');
      }
      await this.pageAccessService.validateCanEdit(parent, user);
    } else {
      await this.assertCanCreatePage(dto.spaceId, user);
    }

    const page = await this.pageService.create(user.id, workspace.id, {
      spaceId: dto.spaceId,
      parentPageId: dto.parentPageId,
      title: template.title ?? undefined,
      icon: template.icon ?? undefined,
      content: (template.content as object) ?? EMPTY_DOC,
      format: 'json',
    });

    this.auditService.log({
      event: AuditEvent.PAGE_CREATED,
      resourceType: AuditResource.PAGE,
      resourceId: page.id,
      spaceId: page.spaceId,
      changes: { after: { title: page.title, spaceId: page.spaceId } },
      metadata: { templateId: template.id },
    });

    return page;
  }

  private async findVisibleOrThrow(
    templateId: string,
    user: User,
    workspace: Workspace,
    opts?: { includeContent?: boolean },
  ): Promise<{ template: TemplateRow; userSpaceIds: string[] }> {
    const template = await this.templateRepo.findById(templateId, workspace.id, {
      includeContent: opts?.includeContent,
    });
    if (!template || template.deletedAt) {
      throw new NotFoundException('Template not found');
    }
    const userSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(user.id);
    const visible =
      template.allSpaces ||
      template.spaceIds.some((id) => userSpaceIds.includes(id));
    // 不可见与不存在返回同一错误，避免泄露模板存在性
    if (!visible) throw new NotFoundException('Template not found');
    return { template, userSpaceIds };
  }

  private normalizeAvailability(input: {
    allSpaces?: boolean;
    spaceIds?: string[];
  }): Availability {
    if (input.allSpaces) return { allSpaces: true, spaceIds: [] };
    const spaceIds = [...new Set(input.spaceIds ?? [])];
    if (spaceIds.length === 0) {
      throw new BadRequestException(
        'Choose at least one space, or make the template available in all spaces',
      );
    }
    return { allSpaces: false, spaceIds };
  }

  private membersAllowed(workspace: Workspace): boolean {
    const settings = workspace.settings as any;
    return settings?.templates?.allowMemberTemplates === true;
  }

  private canManage(template: TemplateRow, user: User, workspace: Workspace) {
    if (isWorkspaceAdmin(user.role)) return true;
    return this.membersAllowed(workspace) && template.creatorId === user.id;
  }

  private assertCanManage(template: TemplateRow, user: User, workspace: Workspace) {
    if (!this.canManage(template, user, workspace)) {
      throw new ForbiddenException();
    }
  }

  /**
   * 校验能否设置该可用范围。
   * @param currentSpaceIds 已指定的空间；新增的空间才需要建页权限。null 表示原来是"所有空间"。
   */
  private async assertCanAssign(
    next: Availability,
    currentSpaceIds: string[] | null,
    user: User,
    workspace: Workspace,
  ) {
    if (!isWorkspaceAdmin(user.role) && !this.membersAllowed(workspace)) {
      throw new ForbiddenException();
    }
    if (next.allSpaces) return;
    const added = next.spaceIds.filter((id) => !currentSpaceIds?.includes(id));
    for (const spaceId of added) {
      await this.assertCanCreatePage(spaceId, user);
    }
  }

  private async assertCanCreatePage(spaceId: string, user: User) {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Create, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
  }

  private async readSourcePageContent(
    pageId: string,
    user: User,
    workspace: Workspace,
  ) {
    const page: Page = await this.pageRepo.findById(pageId, {
      includeContent: true,
    });
    if (!page || page.deletedAt || page.workspaceId !== workspace.id) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.validateCanView(page, user);
    return page.content ?? EMPTY_DOC;
  }

  private toText(content: any): string {
    try {
      jsonToNode(content);
      return jsonToText(content);
    } catch {
      throw new BadRequestException('Invalid content format');
    }
  }

  private toView(
    template: TemplateRow,
    user: User,
    workspace: Workspace,
    userSpaceIds: string[],
  ): TemplateView {
    const spaceIds = template.spaceIds ?? [];
    const visibleSpaceIds = spaceIds.filter((id) => userSpaceIds.includes(id));
    return {
      ...template,
      spaceIds: visibleSpaceIds,
      otherSpaceCount: spaceIds.length - visibleSpaceIds.length,
      canManage: this.canManage(template, user, workspace),
    };
  }
}

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}
