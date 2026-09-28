import { Kysely, sql } from 'kysely';

/**
 * Drops dead columns with no current producer or consumer:
 *
 * knowledge_space_compile_runs (KC-016): the space "plan" model was replaced
 * by runtime Catalog lookups. `aggregate_required` is always written false,
 * `catalog_snapshot` always `[]`, `catalog_hash` always 'pending-initialization';
 * none is read back.
 *
 * knowledge_compilation_attempts (KC-017): prepared-import reuse is disabled.
 * `savePendingImport`/`findPendingImport` have no production caller, so the
 * pending_* payload is never populated or consumed.
 *
 * No value migration is required: the columns hold only their write-once
 * defaults (or NULL), so dropping them cannot lose live state.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    LOCK TABLE knowledge_space_compile_runs IN SHARE ROW EXCLUSIVE MODE
  `.execute(db);
  await sql`
    LOCK TABLE knowledge_compilation_attempts IN SHARE ROW EXCLUSIVE MODE
  `.execute(db);

  await db.schema
    .alterTable('knowledge_space_compile_runs')
    .dropColumn('aggregate_required')
    .dropColumn('catalog_snapshot')
    .dropColumn('catalog_hash')
    .execute();

  await db.schema
    .alterTable('knowledge_compilation_attempts')
    .dropColumn('pending_created_at')
    .dropColumn('pending_effective_knowledge_hash')
    .dropColumn('pending_import')
    .dropColumn('pending_source_version')
    .dropColumn('pending_space_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    LOCK TABLE knowledge_space_compile_runs IN SHARE ROW EXCLUSIVE MODE
  `.execute(db);
  await sql`
    LOCK TABLE knowledge_compilation_attempts IN SHARE ROW EXCLUSIVE MODE
  `.execute(db);

  await db.schema
    .alterTable('knowledge_space_compile_runs')
    // Rows created after `up()` need a value during rollback: PostgreSQL cannot
    // add a NOT NULL column to a populated table without backfilling it.
    .addColumn('catalog_hash', 'varchar', (col) =>
      col.notNull().defaultTo('pending-initialization'),
    )
    .addColumn('catalog_snapshot', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn('aggregate_required', 'boolean', (col) =>
      col.notNull().defaultTo(true),
    )
    .execute();

  await db.schema
    .alterTable('knowledge_compilation_attempts')
    .addColumn('pending_import', 'jsonb')
    .addColumn('pending_space_id', 'uuid')
    .addColumn('pending_source_version', 'varchar')
    .addColumn('pending_effective_knowledge_hash', 'varchar')
    .addColumn('pending_created_at', 'timestamptz')
    .execute();
}
