import { EventEmitter2 } from '@nestjs/event-emitter';
import { Readable } from 'stream';
import { AttachmentRepo } from '@akasha/db/repos/attachment/attachment.repo';
import { Attachment } from '@akasha/db/types/entity.types';
import { EventName } from '../../../common/events/event.contants';
import { AttachmentType } from '../attachment.constants';
import { AttachmentService } from './attachment.service';

describe('AttachmentService', () => {
  it('emits a page update when a page raster attachment is deleted by path', async () => {
    const { service, attachmentRepo, eventEmitter } = createService();
    attachmentRepo.deleteAttachmentByFilePath.mockResolvedValue(
      attachmentRow({
        type: AttachmentType.File,
        pageId: 'page-1',
        mimeType: 'image/png',
        fileExt: '.png',
      }),
    );

    await service.deleteRedundantFile('files/workspace-1/attachment-1/a.png');

    expect(eventEmitter.emit).toHaveBeenCalledWith(EventName.PAGE_UPDATED, {
      pageIds: ['page-1'],
      workspaceId: 'workspace-1',
    });
  });

  it('emits a page update when a non-image page File attachment is deleted (§9.1)', async () => {
    const { service, attachmentRepo, eventEmitter } = createService();
    attachmentRepo.deleteAttachmentByFilePath.mockResolvedValue(
      attachmentRow({
        type: AttachmentType.File,
        pageId: 'page-1',
        fileName: 'spec.pdf',
        mimeType: 'application/pdf',
        fileExt: '.pdf',
      }),
    );

    await service.deleteRedundantFile(
      'files/workspace-1/attachment-1/spec.pdf',
    );

    expect(eventEmitter.emit).toHaveBeenCalledWith(EventName.PAGE_UPDATED, {
      pageIds: ['page-1'],
      workspaceId: 'workspace-1',
    });
  });

  it('does not emit a page update for a chat attachment', async () => {
    const { service, attachmentRepo, eventEmitter } = createService();
    attachmentRepo.deleteAttachmentByFilePath.mockResolvedValue(
      attachmentRow({
        type: AttachmentType.Chat,
        pageId: null,
        aiChatId: 'chat-1',
        fileName: 'notes.pdf',
        mimeType: 'application/pdf',
        fileExt: '.pdf',
      }),
    );

    await service.deleteRedundantFile(
      'chat/workspace-1/attachment-1/notes.pdf',
    );

    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('does not emit a page update for non-page image attachments', async () => {
    const { service, attachmentRepo, eventEmitter } = createService();
    attachmentRepo.deleteAttachmentByFilePath.mockResolvedValue(
      attachmentRow({
        type: AttachmentType.Avatar,
        pageId: null,
        mimeType: 'image/png',
        fileExt: '.png',
      }),
    );

    await service.deleteRedundantFile('avatars/workspace-1/a.png');

    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('does not emit a page update for a newly uploaded file before its node is persisted', async () => {
    const { service, attachmentRepo, eventEmitter } = createService();
    attachmentRepo.insertAttachment.mockResolvedValue(
      attachmentRow({
        type: AttachmentType.File,
        pageId: 'page-1',
        fileName: 'new.pdf',
        fileExt: '.pdf',
        mimeType: 'application/pdf',
      }),
    );

    await service.uploadFile({
      filePromise: Promise.resolve({
        filename: 'new.pdf',
        file: Readable.from([Buffer.from('contents')]),
      } as never),
      pageId: 'page-1',
      userId: 'user-1',
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
    });

    expect(eventEmitter.emit).not.toHaveBeenCalledWith(
      EventName.PAGE_UPDATED,
      expect.anything(),
    );
  });
});

function createService() {
  const storageService = {
    delete: jest.fn().mockResolvedValue(undefined),
    upload: jest.fn().mockResolvedValue(undefined),
  };
  const attachmentRepo = {
    deleteAttachmentByFilePath: jest.fn(),
    insertAttachment: jest.fn(),
  };
  const attachmentQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const eventEmitter = { emit: jest.fn() };
  const service = new AttachmentService(
    storageService as never,
    attachmentRepo as unknown as AttachmentRepo,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    attachmentQueue as never,
    eventEmitter as unknown as EventEmitter2,
  );
  return { service, attachmentRepo, eventEmitter };
}

function attachmentRow(
  overrides: Partial<Attachment> & Pick<Attachment, 'type'>,
): Attachment {
  return {
    id: 'attachment-1',
    fileName: 'a.png',
    filePath: 'files/workspace-1/attachment-1/a.png',
    fileSize: '123',
    fileExt: '.png',
    mimeType: 'image/png',
    textContent: null,
    type: AttachmentType.File,
    creatorId: 'user-1',
    pageId: 'page-1',
    spaceId: 'space-1',
    aiChatId: null,
    workspaceId: 'workspace-1',
    createdAt: new Date('2026-08-07T00:00:00.000Z'),
    updatedAt: new Date('2026-08-07T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as unknown as Attachment;
}
