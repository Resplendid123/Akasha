import { Kysely, sql } from 'kysely';

/** Supports the scope deletes performed by a force Space rebuild. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE INDEX IF NOT EXISTS idx_knowledge_access_principals_source_page
      ON knowledge_source_access_principals (workspace_id, source_page_id)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_knowledge_source_analyses_workspace_space
      ON knowledge_source_analyses (workspace_id, space_id)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP INDEX IF EXISTS idx_knowledge_source_analyses_workspace_space
  `.execute(db);
  await sql`
    DROP INDEX IF EXISTS idx_knowledge_access_principals_source_page
  `.execute(db);
}
