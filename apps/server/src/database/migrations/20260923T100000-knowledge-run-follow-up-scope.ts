import { Kysely, sql } from 'kysely';

/**
 * Keeps the immutable scope used to discover the current Run separate from the
 * pages accumulated for a convergence follow-up. `rerun_requested` disambiguates
 * a NULL follow-up scope: false means no follow-up, true means full-Space.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('knowledge_space_compile_runs')
    .addColumn('follow_up_target_source_page_ids', 'jsonb')
    .execute();

  // Older code stored an initialized Run's pending follow-up scope in
  // target_source_page_ids. Preserve that intent for active and historical rows
  // while future writes keep the two meanings separate.
  await sql`
    UPDATE knowledge_space_compile_runs
    SET follow_up_target_source_page_ids = target_source_page_ids
    WHERE rerun_requested = true
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Restore the legacy encoding before dropping the dedicated column so an
  // active rerun request survives a rollback.
  await sql`
    UPDATE knowledge_space_compile_runs
    SET target_source_page_ids = follow_up_target_source_page_ids
    WHERE rerun_requested = true
  `.execute(db);

  await db.schema
    .alterTable('knowledge_space_compile_runs')
    .dropColumn('follow_up_target_source_page_ids')
    .execute();
}
