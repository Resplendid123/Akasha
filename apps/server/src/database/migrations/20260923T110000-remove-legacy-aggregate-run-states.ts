import { Kysely, sql } from 'kysely';

/**
 * Removes aggregate workflow states that have no producer in the current
 * compiler. Active legacy rows must be drained or cancelled operationally;
 * guessing a resumable phase here could replay work under the wrong lease.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    LOCK TABLE knowledge_space_compile_runs IN SHARE ROW EXCLUSIVE MODE
  `.execute(db);

  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM knowledge_space_compile_runs
        WHERE status = 'aggregate_pending'
           OR (
             phase IN ('initial_aggregate', 'final_aggregate')
             AND status IN ('queued', 'compiling', 'aggregating')
           )
      ) THEN
        RAISE EXCEPTION USING
          MESSAGE = 'Cannot remove legacy aggregate states while legacy Runs are active',
          HINT = 'Drain or cancel aggregate_pending/initial_aggregate/final_aggregate Runs, then retry the migration.';
      END IF;
    END
    $$
  `.execute(db);

  // Terminal legacy rows are retained for audit history under the closest
  // current phase. No active row is rewritten by these updates.
  await sql`
    UPDATE knowledge_space_compile_runs
    SET phase = 'text', updated_at = now()
    WHERE phase = 'initial_aggregate'
  `.execute(db);
  await sql`
    UPDATE knowledge_space_compile_runs
    SET phase = 'finalizing', updated_at = now()
    WHERE phase = 'final_aggregate'
  `.execute(db);

  await sql`
    DROP INDEX IF EXISTS uq_knowledge_space_compile_runs_active_space
  `.execute(db);
  await sql`
    ALTER TABLE knowledge_space_compile_runs
      DROP CONSTRAINT IF EXISTS chk_knowledge_space_compile_runs_status,
      ADD CONSTRAINT chk_knowledge_space_compile_runs_status
      CHECK (status IN (
        'queued', 'compiling', 'aggregating',
        'succeeded', 'partial', 'failed', 'superseded', 'cancelled'
      )),
      DROP CONSTRAINT IF EXISTS chk_knowledge_space_compile_runs_phase,
      ADD CONSTRAINT chk_knowledge_space_compile_runs_phase
      CHECK (phase IN (
        'text', 'images', 'image_merge', 'finalizing', 'complete'
      ))
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX uq_knowledge_space_compile_runs_active_space
      ON knowledge_space_compile_runs (workspace_id, space_id)
      WHERE status IN ('queued', 'compiling', 'aggregating')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    LOCK TABLE knowledge_space_compile_runs IN SHARE ROW EXCLUSIVE MODE
  `.execute(db);
  await sql`
    DROP INDEX IF EXISTS uq_knowledge_space_compile_runs_active_space
  `.execute(db);
  await sql`
    ALTER TABLE knowledge_space_compile_runs
      DROP CONSTRAINT IF EXISTS chk_knowledge_space_compile_runs_status,
      ADD CONSTRAINT chk_knowledge_space_compile_runs_status
      CHECK (status IN (
        'queued', 'compiling', 'aggregate_pending', 'aggregating',
        'succeeded', 'partial', 'failed', 'superseded', 'cancelled'
      )),
      DROP CONSTRAINT IF EXISTS chk_knowledge_space_compile_runs_phase,
      ADD CONSTRAINT chk_knowledge_space_compile_runs_phase
      CHECK (phase IN (
        'text', 'initial_aggregate', 'images', 'image_merge',
        'final_aggregate', 'finalizing', 'complete'
      ))
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX uq_knowledge_space_compile_runs_active_space
      ON knowledge_space_compile_runs (workspace_id, space_id)
      WHERE status IN (
        'queued', 'compiling', 'aggregate_pending', 'aggregating'
      )
  `.execute(db);
}
