jest.mock('../../collaboration/collaboration.gateway', () => ({
  CollaborationGateway: class CollaborationGateway {},
}));

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TemplateService } from './template.service';
import { UserRole } from '../../common/helpers/types/permission';

const DOC = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: '你好' }] }],
};

const row = (over: Record<string, any> = {}) => ({
  id: 't1',
  title: '模板',
  allSpaces: false,
  spaceIds: ['space-1'],
  creatorId: 'member-1',
  content: DOC,
  ...over,
});

describe('TemplateService', () => {
  const admin = { id: 'admin-1', role: UserRole.ADMIN } as any;
  const member = { id: 'member-1', role: UserRole.MEMBER } as any;
  const ws = (allowMemberTemplates = false) =>
    ({ id: 'ws-1', settings: { templates: { allowMemberTemplates } } }) as any;

  const createSubject = (opts?: {
    template?: any;
    userSpaceIds?: string[];
    cannotCreateIn?: string[];
    page?: any;
  }) => {
    const templateRepo = {
      findById: jest.fn().mockResolvedValue(opts?.template),
      findTemplates: jest.fn().mockResolvedValue({ items: [], meta: {} }),
      insertTemplate: jest.fn().mockResolvedValue({ id: 'tpl-new' }),
      updateTemplate: jest.fn().mockResolvedValue(undefined),
      setTemplateSpaces: jest.fn().mockResolvedValue(undefined),
      deleteTemplate: jest.fn().mockResolvedValue(undefined),
    };
    const pageRepo = { findById: jest.fn().mockResolvedValue(opts?.page) };
    const spaceMemberRepo = {
      getUserSpaceIds: jest
        .fn()
        .mockResolvedValue(opts?.userSpaceIds ?? ['space-1', 'space-2']),
    };
    const spaceAbility = {
      createForUser: jest.fn(async (_user, spaceId: string) => ({
        cannot: jest
          .fn()
          .mockReturnValue((opts?.cannotCreateIn ?? []).includes(spaceId)),
      })),
    };
    const pageAccessService = {
      validateCanView: jest.fn().mockResolvedValue(undefined),
      validateCanEdit: jest.fn().mockResolvedValue({}),
    };
    const pageService = {
      create: jest.fn().mockResolvedValue({ id: 'page-new', spaceId: 'space-1' }),
    };
    const auditService = { log: jest.fn() };
    // 事务直接执行回调
    const db = {
      transaction: () => ({ execute: (cb: any) => cb('trx') }),
    };

    const service = new TemplateService(
      templateRepo as any,
      pageRepo as any,
      spaceMemberRepo as any,
      spaceAbility as any,
      pageAccessService as any,
      pageService as any,
      auditService as any,
      db as any,
    );
    return { service, templateRepo, pageService, pageAccessService };
  };

  describe('create', () => {
    it('管理员可创建"所有空间"模板，并提取纯文本', async () => {
      const { service, templateRepo } = createSubject({
        template: row({ allSpaces: true, spaceIds: [], creatorId: 'admin-1' }),
      });
      const result = await service.create(
        { title: '周报', allSpaces: true, content: DOC },
        admin,
        ws(),
      );
      expect(templateRepo.insertTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ allSpaces: true, textContent: '你好' }),
        'trx',
      );
      expect(templateRepo.setTemplateSpaces).toHaveBeenCalledWith('tpl-new', [], 'trx');
      expect(result.canManage).toBe(true);
    });

    it('可指定多个空间，重复空间去重', async () => {
      const { service, templateRepo } = createSubject({ template: row() });
      await service.create(
        { title: 't', spaceIds: ['space-1', 'space-2', 'space-1'] },
        admin,
        ws(),
      );
      expect(templateRepo.setTemplateSpaces).toHaveBeenCalledWith(
        'tpl-new',
        ['space-1', 'space-2'],
        'trx',
      );
    });

    it('既不是所有空间也没指定空间时返回 400', async () => {
      const { service } = createSubject();
      await expect(
        service.create({ title: 't', spaceIds: [] }, admin, ws()),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('未指定范围时默认"所有空间"', async () => {
      const { service, templateRepo } = createSubject({
        template: row({ allSpaces: true, spaceIds: [] }),
      });
      await service.create({ title: 't' }, member, ws(true));
      expect(templateRepo.insertTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ allSpaces: true }),
        'trx',
      );
      expect(templateRepo.setTemplateSpaces).toHaveBeenCalledWith('tpl-new', [], 'trx');
    });

    it('获准的成员也可以创建"所有空间"模板，并能管理它', async () => {
      const { service } = createSubject({
        template: row({ allSpaces: true, spaceIds: [], creatorId: 'member-1' }),
      });
      const view = await service.create({ title: 't', allSpaces: true }, member, ws(true));
      expect(view.canManage).toBe(true);
    });

    it('未开启成员模板开关时成员不能创建', async () => {
      const { service } = createSubject();
      await expect(service.create({ title: 't' }, member, ws(false))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        service.create({ title: 't', spaceIds: ['space-1'] }, member, ws(false)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('任一指定空间没有建页权限时拒绝', async () => {
      const { service, templateRepo } = createSubject({ cannotCreateIn: ['space-2'] });
      await expect(
        service.create(
          { title: 't', spaceIds: ['space-1', 'space-2'] },
          member,
          ws(true),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(templateRepo.insertTemplate).not.toHaveBeenCalled();
    });

    it('另存为模板时校验页面可读并复制正文', async () => {
      const { service, templateRepo, pageAccessService } = createSubject({
        template: row(),
        page: { id: 'p1', workspaceId: 'ws-1', content: DOC },
      });
      await service.create(
        { title: 't', spaceIds: ['space-1'], sourcePageId: 'p1' },
        member,
        ws(true),
      );
      expect(pageAccessService.validateCanView).toHaveBeenCalled();
      expect(templateRepo.insertTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ content: DOC }),
        'trx',
      );
    });

    it('来源页面跨工作区时返回 404', async () => {
      const { service } = createSubject({
        page: { id: 'p1', workspaceId: 'ws-other', content: DOC },
      });
      await expect(
        service.create({ title: 't', allSpaces: true, sourcePageId: 'p1' }, admin, ws()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('非法正文返回 400', async () => {
      const { service } = createSubject();
      await expect(
        service.create(
          { title: 't', allSpaces: true, content: { type: 'nope' } },
          admin,
          ws(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('可见性与管理', () => {
    it('模板指定的空间都不在用户可访问范围内时返回 404', async () => {
      const { service } = createSubject({
        template: row({ spaceIds: ['space-x', 'space-y'] }),
        userSpaceIds: ['space-1'],
      });
      await expect(service.getById('t1', member, ws())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('只返回用户可访问的空间，并给出其余空间数量', async () => {
      const { service } = createSubject({
        template: row({ spaceIds: ['space-1', 'space-x', 'space-y'] }),
        userSpaceIds: ['space-1'],
      });
      const view = await service.getById('t1', member, ws());
      expect(view.spaceIds).toEqual(['space-1']);
      expect(view.otherSpaceCount).toBe(2);
    });

    it('成员只能删除自己创建的模板', async () => {
      const own = createSubject({ template: row() });
      await own.service.delete('t1', member, ws(true));
      expect(own.templateRepo.deleteTemplate).toHaveBeenCalled();

      const other = createSubject({ template: row({ creatorId: 'someone' }) });
      await expect(other.service.delete('t1', member, ws(true))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('改为指定空间但一个都没选时返回 400', async () => {
      const { service } = createSubject({
        template: row({ allSpaces: true, spaceIds: [] }),
      });
      await expect(
        service.update(
          { templateId: 't1', allSpaces: false, spaceIds: [] },
          admin,
          ws(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('更新空间时保留用户看不到的已指定空间', async () => {
      const { service, templateRepo } = createSubject({
        template: row({ spaceIds: ['space-1', 'space-hidden'] }),
        userSpaceIds: ['space-1', 'space-2'],
      });
      await service.update(
        { templateId: 't1', spaceIds: ['space-2'] },
        admin,
        ws(),
      );
      expect(templateRepo.setTemplateSpaces).toHaveBeenCalledWith(
        't1',
        ['space-2', 'space-hidden'],
        'trx',
      );
    });

    it('只对新增的空间校验建页权限', async () => {
      const { service } = createSubject({
        // 管理员对原空间 space-1 已无建页权限，但没有新增空间时不应被拦
        template: row({ spaceIds: ['space-1'] }),
        cannotCreateIn: ['space-1'],
      });
      await expect(
        service.update({ templateId: 't1', spaceIds: ['space-1'] }, admin, ws()),
      ).resolves.toBeDefined();
    });
  });

  describe('use', () => {
    it('以模板标题/图标/正文创建页面', async () => {
      const { service, pageService } = createSubject({
        template: row({ allSpaces: true, spaceIds: [], title: '会议纪要', icon: '📝' }),
      });
      await service.use({ templateId: 't1', spaceId: 'space-1' }, member, ws());
      expect(pageService.create).toHaveBeenCalledWith('member-1', 'ws-1', {
        spaceId: 'space-1',
        parentPageId: undefined,
        title: '会议纪要',
        icon: '📝',
        content: DOC,
        format: 'json',
      });
    });

    it('模板未指定到目标空间时返回 400', async () => {
      const { service, pageService } = createSubject({
        template: row({ spaceIds: ['space-1'] }),
      });
      await expect(
        service.use({ templateId: 't1', spaceId: 'space-2' }, member, ws()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(pageService.create).not.toHaveBeenCalled();
    });

    it('目标空间无建页权限时拒绝', async () => {
      const { service, pageService } = createSubject({
        template: row({ allSpaces: true, spaceIds: [] }),
        cannotCreateIn: ['space-1'],
      });
      await expect(
        service.use({ templateId: 't1', spaceId: 'space-1' }, member, ws()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(pageService.create).not.toHaveBeenCalled();
    });

    it('父页面不在目标空间时返回 404', async () => {
      const { service } = createSubject({
        template: row({ allSpaces: true, spaceIds: [] }),
        page: { id: 'p1', workspaceId: 'ws-1', spaceId: 'space-2' },
      });
      await expect(
        service.use(
          { templateId: 't1', spaceId: 'space-1', parentPageId: 'p1' },
          member,
          ws(),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
