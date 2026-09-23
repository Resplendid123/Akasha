import { Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import {
  IPageBacklinkJob,
  IPageHistoryDiffJob,
  IPageHistoryJob,
  IPageUpdateNotificationJob,
} from '../../integrations/queue/constants/queue.interface';
import {
  extractMentions,
  extractPageMentions,
  extractInternalLinkSlugIds,
} from '../../common/helpers/prosemirror/utils';
import { PageHistoryRepo } from '@akasha/db/repos/page/page-history.repo';
import { JsonValue } from '@akasha/db/types/db';
import { PageRepo } from '@akasha/db/repos/page/page.repo';
import { isDeepStrictEqual } from 'node:util';
import { CollabHistoryService } from '../services/collab-history.service';
import { WatcherService } from '../../core/watcher/watcher.service';
import { isEmptyParagraphDoc, tiptapExtensions } from '../collaboration.util';
import { getSchema } from '@tiptap/core';
import {
  createHistoryDiff,
  HISTORY_DIFF_ALGORITHM_VERSION,
  HISTORY_DIFF_SCHEMA_VERSION,
} from '@docmost/editor-ext';

@Processor(QueueName.HISTORY_QUEUE)
export class HistoryProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(HistoryProcessor.name);

  constructor(
    private readonly pageHistoryRepo: PageHistoryRepo,
    private readonly pageRepo: PageRepo,
    private readonly collabHistory: CollabHistoryService,
    private readonly watcherService: WatcherService,
    @InjectQueue(QueueName.NOTIFICATION_QUEUE) private notificationQueue: Queue,
    @InjectQueue(QueueName.GENERAL_QUEUE) private generalQueue: Queue,
    @InjectQueue(QueueName.HISTORY_DIFF_QUEUE) private historyDiffQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<IPageHistoryJob, void>): Promise<void> {
    if (job.name !== QueueJob.PAGE_HISTORY) return;

    try {
      const { pageId } = job.data;

      const page = await this.pageRepo.findById(pageId, {
        includeContent: true,
      });

      if (!page) {
        this.logger.warn(`Page ${pageId} not found, skipping history`);
        await this.collabHistory.clearContributors(pageId);
        return;
      }

      const lastHistory = await this.pageHistoryRepo.findPageLastHistory(
        pageId,
        { includeContent: true },
      );

      if (!lastHistory && isEmptyParagraphDoc(page.content as any)) {
        this.logger.debug(
          `Skipping first history for page ${pageId}: empty content`,
        );
        await this.collabHistory.clearContributors(pageId);
        return;
      }

      if (
        !lastHistory ||
        !isDeepStrictEqual(lastHistory.content, page.content)
      ) {
        const contributorIds = await this.collabHistory.popContributors(pageId);

        try {
          await this.watcherService.addPageWatchers(
            contributorIds,
            pageId,
            page.spaceId,
            page.workspaceId,
          );

          const newHistory = await this.pageHistoryRepo.saveHistory(page, {
            contributorIds,
          });
          this.logger.debug(`History created for page: ${pageId}`);

          if (lastHistory) {
            await this.enqueueHistoryDiff(lastHistory.id, newHistory.id).catch(
              (err) => {
                this.logger.error(
                  `Failed to queue history diff for ${newHistory.id}: ${err.message}`,
                );
              },
            );
          }
        } catch (err) {
          await this.collabHistory.addContributors(pageId, contributorIds);
          throw err;
        }

        const mentions = extractMentions(page.content);
        const pageMentions = extractPageMentions(mentions);
        const internalLinkSlugIds = extractInternalLinkSlugIds(page.content);

        await this.generalQueue
          .add(QueueJob.PAGE_BACKLINKS, {
            pageId,
            workspaceId: page.workspaceId,
            mentions: pageMentions,
            internalLinkSlugIds,
          } as IPageBacklinkJob)
          .catch((err) => {
            this.logger.error(
              `Failed to queue backlinks for ${pageId}: ${err.message}`,
            );
          });

        if (contributorIds.length > 0 && lastHistory?.content) {
          await this.notificationQueue
            .add(QueueJob.PAGE_UPDATED, {
              pageId,
              spaceId: page.spaceId,
              workspaceId: page.workspaceId,
              actorIds: contributorIds,
            } as IPageUpdateNotificationJob)
            .catch((err) => {
              this.logger.error(
                `Failed to queue page update notification for ${pageId}: ${err.message}`,
              );
            });
        }
      }
    } catch (err) {
      throw err;
    }
  }

  private async enqueueHistoryDiff(
    fromHistoryId: string,
    toHistoryId: string,
  ): Promise<void> {
    await this.pageHistoryRepo.createPendingDiff({
      fromHistoryId,
      toHistoryId,
      algorithmVersion: HISTORY_DIFF_ALGORITHM_VERSION,
      schemaVersion: HISTORY_DIFF_SCHEMA_VERSION,
    });
    await this.historyDiffQueue.add(
      QueueJob.PAGE_HISTORY_DIFF,
      {
        fromHistoryId,
        toHistoryId,
        algorithmVersion: HISTORY_DIFF_ALGORITHM_VERSION,
      } as IPageHistoryDiffJob,
      {
        jobId: `history-diff-${toHistoryId}-${HISTORY_DIFF_ALGORITHM_VERSION}`,
      },
    );
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.debug(`Processing ${job.name} for page: ${job.data.pageId}`);
  }

  @OnWorkerEvent('failed')
  onError(job: Job) {
    this.logger.error(
      `Failed ${job.name} for page: ${job.data.pageId}. Reason: ${job.failedReason}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }
}

const MAX_HISTORY_DIFF_CONTENT_BYTES = 5 * 1024 * 1024;
const MAX_HISTORY_DIFF_RESULT_BYTES = 5 * 1024 * 1024;

@Processor(QueueName.HISTORY_DIFF_QUEUE, { concurrency: 1 })
export class HistoryDiffProcessor
  extends WorkerHost
  implements OnModuleDestroy
{
  private readonly logger = new Logger(HistoryDiffProcessor.name);

  constructor(private readonly pageHistoryRepo: PageHistoryRepo) {
    super();
  }

  async process(job: Job<IPageHistoryDiffJob, void>): Promise<void> {
    if (job.name !== QueueJob.PAGE_HISTORY_DIFF) return;

    const { fromHistoryId, toHistoryId, algorithmVersion } = job.data;
    const existing = await this.pageHistoryRepo.findDiffByTargetHistoryId(
      toHistoryId,
      algorithmVersion,
      HISTORY_DIFF_SCHEMA_VERSION,
    );
    if (existing?.status === 'ready') return;

    try {
      const [fromHistory, toHistory] = await Promise.all([
        this.pageHistoryRepo.findById(fromHistoryId, { includeContent: true }),
        this.pageHistoryRepo.findById(toHistoryId, { includeContent: true }),
      ]);

      if (!fromHistory || !toHistory) {
        throw new Error('history_not_found');
      }
      if (fromHistory.pageId !== toHistory.pageId) {
        throw new Error('history_page_mismatch');
      }
      if (!fromHistory.content || !toHistory.content) {
        throw new Error('history_content_missing');
      }

      await this.pageHistoryRepo.updateDiffStatus(
        toHistoryId,
        algorithmVersion,
        'running',
      );

      const fromJson = JSON.stringify(fromHistory.content);
      const toJson = JSON.stringify(toHistory.content);
      if (
        Buffer.byteLength(fromJson) > MAX_HISTORY_DIFF_CONTENT_BYTES ||
        Buffer.byteLength(toJson) > MAX_HISTORY_DIFF_CONTENT_BYTES
      ) {
        await this.pageHistoryRepo.updateDiffStatus(
          toHistoryId,
          algorithmVersion,
          'too_large',
          'content_too_large',
        );
        return;
      }

      const schema = getSchema(tiptapExtensions);
      const result = createHistoryDiff(
        schema,
        fromHistory.content,
        toHistory.content,
      );
      const changesJson = JSON.stringify(result.changes);
      if (Buffer.byteLength(changesJson) > MAX_HISTORY_DIFF_RESULT_BYTES) {
        await this.pageHistoryRepo.updateDiffStatus(
          toHistoryId,
          algorithmVersion,
          'too_large',
          'result_too_large',
        );
        return;
      }

      await this.pageHistoryRepo.completeDiff(toHistoryId, algorithmVersion, {
        changes: result.changes as unknown as JsonValue,
        addedCount: result.addedCount,
        deletedCount: result.deletedCount,
        fromContentHash: this.hash(fromJson),
        toContentHash: this.hash(toJson),
      });
    } catch (error) {
      const errorCode =
        error instanceof Error ? error.message.slice(0, 200) : 'unknown_error';
      await this.pageHistoryRepo.updateDiffStatus(
        toHistoryId,
        algorithmVersion,
        'failed',
        errorCode,
      );
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job) {
    this.logger.error(
      `Failed history diff for ${job.data.toHistoryId}: ${job.failedReason}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }

  private hash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}
