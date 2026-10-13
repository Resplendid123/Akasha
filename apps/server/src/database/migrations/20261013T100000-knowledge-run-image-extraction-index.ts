import { Kysely, sql } from 'kysely';

/**
 * PostgreSQL does not automatically index the referencing side of a foreign
 * key. Force rebuild deletes image extractions, whose ON DELETE SET NULL
 * action otherwise scans the entire RunImage table for every deleted row.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE INDEX IF NOT EXISTS idx_knowledge_space_compile_run_images_extraction_id
      ON knowledge_space_compile_run_images (extraction_id)
      WHERE extraction_id IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP INDEX IF EXISTS idx_knowledge_space_compile_run_images_extraction_id
  `.execute(db);
}
