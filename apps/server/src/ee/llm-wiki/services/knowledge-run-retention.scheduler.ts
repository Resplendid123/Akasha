import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { KnowledgeRunRetentionService } from './knowledge-run-retention.service';

const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const MAX_BATCHES_PER_SCHEDULE = 20;
// Soft budget: checked before starting a batch. The database statement timeout
// remains the hard bound for an individual batch already in progress.
const SCHEDULE_TIME_BUDGET_MS = 30_000;

@Injectable()
export class KnowledgeRunRetentionScheduler {
  private running = false;

  constructor(
    private readonly retention: KnowledgeRunRetentionService,
    private readonly environmentService: EnvironmentService,
  ) {}

  @Interval('knowledge-run-retention', RETENTION_INTERVAL_MS)
  async purgeExpiredRunHistory(): Promise<void> {
    if (
      this.running ||
      !this.environmentService.isKnowledgeRunRetentionEnabled()
    ) {
      return;
    }

    this.running = true;
    const startedAt = Date.now();
    try {
      for (let batch = 0; batch < MAX_BATCHES_PER_SCHEDULE; batch += 1) {
        if (Date.now() - startedAt >= SCHEDULE_TIME_BUDGET_MS) break;
        const result = await this.retention.purgeExpiredRunHistoryBatch();
        if (
          result.deletedImages + result.deletedPages + result.deletedRuns ===
          0
        ) {
          break;
        }
      }
    } catch {
      // A later daily schedule retries. Retention must not affect online work.
    } finally {
      this.running = false;
    }
  }
}
