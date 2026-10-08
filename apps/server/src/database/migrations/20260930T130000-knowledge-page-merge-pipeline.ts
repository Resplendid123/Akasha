import { Kysely, sql } from 'kysely';

/**
 * Page-level image merge pipeline.
 *
 * Adds durable outbox + execution-fence columns to run pages so each ready page
 * can be dispatched to the independent KNOWLEDGE_MERGE_QUEUE, plus the indexes
 * that enforce a single outstanding merge per Run and unique merge job ids.
 *
 * A one-time clean cutover: the migration refuses to run while any active Run
 * exists so no in-flight space-level merge state is silently reinterpreted.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const active = await sql<{
    count: string;
  }>`
    SELECT count(*)::text AS count
    FROM knowledge_space_compile_runs
    WHERE status IN ('queued', 'compiling', 'aggregate_pending', 'aggregating')
  `.execute(db);
  const activeCount = Number(active.rows[0]?.count ?? '0');
  if (activeCount > 0) {
    throw new Error(
      `Refusing to migrate knowledge page merge pipeline: ${activeCount} active ` +
        `run(s) still queued/compiling/aggregating. Drain or cancel active runs first.`,
    );
  }

  await db.schema
    .alterTable('knowledge_space_compile_run_pages')
    .addColumn('merge_dispatched_at', 'timestamptz')
    .addColumn('merge_processing_expires_at', 'timestamptz')
    .addColumn('merge_redis_recovery_count', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('merge_failure_class', 'varchar')
    .addColumn('merge_execution_token', 'varchar')
    .addColumn('merge_worker_id', 'varchar')
    .addColumn('merge_heartbeat_at', 'timestamptz')
    .execute();

  await sql`
    ALTER TABLE knowledge_space_compile_run_pages
      ADD CONSTRAINT chk_knowledge_run_pages_merge_redis_recovery_count
        CHECK (merge_redis_recovery_count BETWEEN 0 AND 3),
      ADD CONSTRAINT chk_knowledge_run_pages_merge_failure_class
        CHECK (
          merge_failure_class IS NULL
          OR merge_failure_class IN ('retryable_exhausted', 'permanent')
        )
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX uq_knowledge_run_pages_merge_job_id
      ON knowledge_space_compile_run_pages (merge_job_id)
      WHERE merge_job_id IS NOT NULL
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX uq_knowledge_run_pages_one_outstanding_merge
      ON knowledge_space_compile_run_pages (run_id)
      WHERE merge_status IN ('queued', 'running')
  `.execute(db);

  await sql`
    CREATE INDEX idx_knowledge_run_pages_merge_dispatch
      ON knowledge_space_compile_run_pages (
        merge_status,
        merge_dispatched_at,
        updated_at
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_knowledge_run_pages_merge_dispatch`.execute(
    db,
  );
  await sql`DROP INDEX IF EXISTS uq_knowledge_run_pages_one_outstanding_merge`.execute(
    db,
  );
  await sql`DROP INDEX IF EXISTS uq_knowledge_run_pages_merge_job_id`.execute(
    db,
  );

  await sql`
    ALTER TABLE knowledge_space_compile_run_pages
      DROP CONSTRAINT IF EXISTS chk_knowledge_run_pages_merge_failure_class,
      DROP CONSTRAINT IF EXISTS chk_knowledge_run_pages_merge_redis_recovery_count
  `.execute(db);

  await db.schema
    .alterTable('knowledge_space_compile_run_pages')
    .dropColumn('merge_heartbeat_at')
    .dropColumn('merge_worker_id')
    .dropColumn('merge_execution_token')
    .dropColumn('merge_failure_class')
    .dropColumn('merge_redis_recovery_count')
    .dropColumn('merge_processing_expires_at')
    .dropColumn('merge_dispatched_at')
    .execute();
}
