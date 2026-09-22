import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('knowledge_graph_edges')
    .addColumn('target_artifact_kind', 'varchar')
    .addColumn('target_canonical_key', 'varchar')
    .addColumn('is_dangling', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .execute();

  await sql`
    UPDATE knowledge_graph_edges AS edge
    SET
      target_artifact_kind = target.page_type,
      target_canonical_key = target.canonical_key
    FROM knowledge_pages AS target
    WHERE target.id = edge.to_knowledge_page_id
  `.execute(db);

  await sql`
    ALTER TABLE knowledge_graph_edges
    ALTER COLUMN to_knowledge_page_id DROP NOT NULL
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_knowledge_graph_edges_canonical_target
      ON knowledge_graph_edges (workspace_id, space_id, target_artifact_kind, target_canonical_key)
      WHERE stale_at IS NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_knowledge_graph_edges_canonical_target`.execute(
    db,
  );
  await sql`
    DELETE FROM knowledge_graph_edges
    WHERE to_knowledge_page_id IS NULL
  `.execute(db);
  await sql`
    ALTER TABLE knowledge_graph_edges
    ALTER COLUMN to_knowledge_page_id SET NOT NULL
  `.execute(db);
  await db.schema
    .alterTable('knowledge_graph_edges')
    .dropColumn('is_dangling')
    .dropColumn('target_canonical_key')
    .dropColumn('target_artifact_kind')
    .execute();
}
