import { Kysely, sql } from 'kysely';

/** Supports the bounded oldest-first scan performed by Run retention. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE INDEX IF NOT EXISTS idx_knowledge_space_compile_runs_retention
      ON knowledge_space_compile_runs (finished_at, id)
      INCLUDE (space_id, knowledge_generation, status)
      WHERE finished_at IS NOT NULL
        AND status IN ('succeeded', 'partial', 'failed', 'cancelled', 'superseded')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP INDEX IF EXISTS idx_knowledge_space_compile_runs_retention
  `.execute(db);
}
