import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '@akasha/db/types/kysely.types';
import { executeTx } from '@akasha/db/utils';

const RUN_RETENTION_DAYS = 30;
const RUN_IMAGE_BATCH_SIZE = 1_000;
const RUN_PAGE_BATCH_SIZE = 1_000;
const RUN_BATCH_SIZE = 100;

export type KnowledgeRunRetentionBatchResult = {
  deletedImages: number;
  deletedPages: number;
  deletedRuns: number;
  durationMs: number;
};

@Injectable()
export class KnowledgeRunRetentionService {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async purgeExpiredRunHistoryBatch(): Promise<KnowledgeRunRetentionBatchResult> {
    const startedAt = Date.now();
    const cutoff = new Date(
      startedAt - RUN_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    );

    const deletedImages = await executeTx(this.db, async (trx) => {
      const result = await sql<{ id: string }>`
        WITH candidates AS (
          SELECT image.id
          FROM knowledge_space_compile_run_images AS image
          INNER JOIN knowledge_space_compile_runs AS run ON run.id = image.run_id
          INNER JOIN spaces AS space ON space.id = run.space_id
          WHERE ${eligibleRun(cutoff)}
          ORDER BY run.finished_at ASC, image.id ASC
          LIMIT ${RUN_IMAGE_BATCH_SIZE}
          FOR UPDATE OF image SKIP LOCKED
        )
        DELETE FROM knowledge_space_compile_run_images AS image
        USING candidates
        WHERE image.id = candidates.id
        RETURNING image.id
      `.execute(trx);
      return result.rows.length;
    });

    const deletedPages = await executeTx(this.db, async (trx) => {
      const result = await sql<{ id: string }>`
        WITH candidates AS (
          SELECT page.id
          FROM knowledge_space_compile_run_pages AS page
          INNER JOIN knowledge_space_compile_runs AS run ON run.id = page.run_id
          INNER JOIN spaces AS space ON space.id = run.space_id
          WHERE ${eligibleRun(cutoff)}
            AND NOT EXISTS (
              SELECT 1
              FROM knowledge_space_compile_run_images AS image
              WHERE image.run_page_id = page.id
            )
          ORDER BY run.finished_at ASC, page.id ASC
          LIMIT ${RUN_PAGE_BATCH_SIZE}
          FOR UPDATE OF page SKIP LOCKED
        )
        DELETE FROM knowledge_space_compile_run_pages AS page
        USING candidates
        WHERE page.id = candidates.id
        RETURNING page.id
      `.execute(trx);
      return result.rows.length;
    });

    const deletedRuns = await executeTx(this.db, async (trx) => {
      const result = await sql<{ id: string }>`
        WITH candidates AS (
          SELECT run.id
          FROM knowledge_space_compile_runs AS run
          INNER JOIN spaces AS space ON space.id = run.space_id
          WHERE ${eligibleRun(cutoff)}
            AND NOT EXISTS (
              SELECT 1
              FROM knowledge_space_compile_run_pages AS page
              WHERE page.run_id = run.id
            )
          ORDER BY run.finished_at ASC, run.id ASC
          LIMIT ${RUN_BATCH_SIZE}
          FOR UPDATE OF run SKIP LOCKED
        )
        DELETE FROM knowledge_space_compile_runs AS run
        USING candidates
        WHERE run.id = candidates.id
        RETURNING run.id
      `.execute(trx);
      return result.rows.length;
    });

    return {
      deletedImages,
      deletedPages,
      deletedRuns,
      durationMs: Date.now() - startedAt,
    };
  }
}

function eligibleRun(cutoff: Date) {
  return sql<boolean>`
    run.finished_at IS NOT NULL
    AND run.finished_at < ${cutoff}
    AND run.status IN ('succeeded', 'partial', 'failed', 'cancelled', 'superseded')
    AND (
      run.knowledge_generation < space.knowledge_generation
      OR run.status IN ('failed', 'cancelled', 'superseded')
    )
  `;
}
