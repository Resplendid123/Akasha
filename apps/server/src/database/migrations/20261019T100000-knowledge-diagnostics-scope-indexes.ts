import { Kysely, sql } from 'kysely';

/**
 * Scope indexes for the bounded admin diagnostics aggregates.
 *
 * The diagnostics endpoint filters the denormalized RunPage/RunImage rows by
 * workspace and Space. The existing dispatch indexes start with status/run_id
 * and therefore cannot avoid scanning historical rows for this access path.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createIndex('idx_knowledge_space_compile_runs_diagnostics_scope_status')
    .on('knowledge_space_compile_runs')
    .columns(['workspace_id', 'space_id', 'status', 'phase'])
    .execute();

  await db.schema
    .createIndex('idx_knowledge_space_compile_run_images_diagnostics_scope')
    .on('knowledge_space_compile_run_images')
    .columns(['workspace_id', 'space_id', 'status'])
    .execute();

  // Only failed RunPage rows participate in failure-category diagnostics.
  // Keeping this partial index small is important for workspaces with a long
  // successful compilation history.
  await sql`
    CREATE INDEX idx_knowledge_space_compile_run_pages_diagnostics_failed
      ON knowledge_space_compile_run_pages (workspace_id, space_id, error_code)
      WHERE status = 'failed' OR merge_status = 'failed'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex('idx_knowledge_space_compile_run_pages_diagnostics_failed')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('idx_knowledge_space_compile_run_images_diagnostics_scope')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('idx_knowledge_space_compile_runs_diagnostics_scope_status')
    .ifExists()
    .execute();
}
