import { Kysely, sql } from 'kysely';

/**
 * Retires the last rows produced by the removed space-level compiler. The
 * application now publishes page-scoped artifacts exclusively, so keeping
 * active overview/space rows would make removal of the compatibility filters
 * unsafe.
 *
 * Historical rows remain available for audit. The constraint only governs
 * active publications and prevents either a legacy scope or overview identity
 * from being reactivated after this migration.
 *
 * Deployment ordering matters: this migration must finish before application
 * nodes serve code that no longer filters legacy overview rows. Production
 * bootstrap runs migrations during module initialization, before the HTTP
 * server starts accepting traffic.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    LOCK TABLE knowledge_pages IN SHARE ROW EXCLUSIVE MODE
  `.execute(db);

  for (const [table, ownerColumn] of [
    ['knowledge_parent_sections', 'knowledge_page_id'],
    ['knowledge_claims', 'knowledge_page_id'],
    ['knowledge_chunks', 'knowledge_page_id'],
    ['knowledge_links', 'from_knowledge_page_id'],
    ['knowledge_graph_edges', 'from_knowledge_page_id'],
  ] as const) {
    await sql
      .raw(
        `
      UPDATE ${table} child
      SET stale_at = COALESCE(child.stale_at, now())
      WHERE child.${ownerColumn} IN (
        SELECT id
        FROM knowledge_pages
        WHERE stale_at IS NULL
          AND (
            compile_scope = 'space'
            OR page_type = 'overview'
            OR canonical_key = 'overview'
          )
      )
    `,
      )
      .execute(db);
  }

  await sql`
    UPDATE knowledge_pages
    SET stale_at = now(), updated_at = now()
    WHERE stale_at IS NULL
      AND (
        compile_scope = 'space'
        OR page_type = 'overview'
        OR canonical_key = 'overview'
      )
  `.execute(db);

  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM knowledge_pages
        WHERE stale_at IS NULL
          AND (
            compile_scope = 'space'
            OR page_type = 'overview'
            OR canonical_key = 'overview'
          )
      ) THEN
        RAISE EXCEPTION 'Active legacy knowledge overview survived retirement';
      END IF;
    END
    $$
  `.execute(db);

  await sql`
    ALTER TABLE knowledge_pages
      ADD CONSTRAINT chk_knowledge_pages_active_page_publication
      CHECK (
        stale_at IS NOT NULL
        OR (
          compile_scope = 'page'
          AND page_type IS DISTINCT FROM 'overview'
        )
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Retirement is intentionally one-way: rollback relaxes the publication
  // guard but does not reactivate historical rows by clearing stale_at.
  await sql`
    ALTER TABLE knowledge_pages
      DROP CONSTRAINT IF EXISTS chk_knowledge_pages_active_page_publication
  `.execute(db);
}
