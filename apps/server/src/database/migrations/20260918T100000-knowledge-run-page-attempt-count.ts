import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('knowledge_space_compile_run_pages')
    .addColumn('attempt_count', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('merge_attempt_count', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .execute();

  await sql`
    ALTER TABLE knowledge_space_compile_run_pages
      ADD CONSTRAINT chk_knowledge_space_compile_run_pages_attempt_count
        CHECK (attempt_count >= 0 AND merge_attempt_count >= 0)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE knowledge_space_compile_run_pages
      DROP CONSTRAINT IF EXISTS
        chk_knowledge_space_compile_run_pages_attempt_count
  `.execute(db);
  await db.schema
    .alterTable('knowledge_space_compile_run_pages')
    .dropColumn('merge_attempt_count')
    .dropColumn('attempt_count')
    .execute();
}
