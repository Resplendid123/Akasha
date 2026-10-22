import { Kysely, sql } from 'kysely';

/** Final deterministic page-link schema; no historical migration is edited. */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`LOCK TABLE knowledge_links,knowledge_link_sources,knowledge_artifact_contributions IN ACCESS EXCLUSIVE MODE`.execute(db);
  await sql`DELETE FROM knowledge_links l WHERE l.to_knowledge_page_id IS NULL
    OR l.link_type NOT IN ('summary_mention','catalog_mention')
    OR NOT EXISTS(SELECT 1 FROM knowledge_pages p WHERE p.id=l.from_knowledge_page_id AND p.workspace_id=l.workspace_id AND p.space_id=l.space_id)
    OR NOT EXISTS(SELECT 1 FROM knowledge_pages p WHERE p.id=l.to_knowledge_page_id AND p.workspace_id=l.workspace_id AND p.space_id=l.space_id)`.execute(db);
  // Move evidence before deleting duplicates. Any stale dependency makes the
  // combined link stale until its contributions are republished.
  await sql`CREATE TEMP TABLE knowledge_link_merge ON COMMIT DROP AS
    SELECT id, first_value(id) OVER(PARTITION BY workspace_id,from_knowledge_page_id,to_knowledge_page_id,link_type ORDER BY id) AS retained_id,
      max(stale_at) OVER(PARTITION BY workspace_id,from_knowledge_page_id,to_knowledge_page_id,link_type) AS merged_stale_at
    FROM knowledge_links`.execute(db);
  await sql`UPDATE knowledge_link_sources s SET link_id=m.retained_id
    FROM knowledge_link_merge m WHERE m.id=s.link_id AND m.id<>m.retained_id`.execute(db);
  await sql`UPDATE knowledge_links l SET stale_at=m.merged_stale_at FROM knowledge_link_merge m WHERE l.id=m.retained_id`.execute(db);
  await sql`DELETE FROM knowledge_links l USING knowledge_link_merge m WHERE l.id=m.id AND m.id<>m.retained_id`.execute(db);
  await sql`DELETE FROM knowledge_link_sources a USING knowledge_link_sources b
    WHERE a.ctid>b.ctid AND a.workspace_id=b.workspace_id AND a.link_id=b.link_id
      AND a.source_page_id=b.source_page_id AND a.source_version=b.source_version AND a.content_hash=b.content_hash
      AND a.source_range IS NOT DISTINCT FROM b.source_range AND a.quote_hash IS NOT DISTINCT FROM b.quote_hash AND a.provenance_kind=b.provenance_kind`.execute(db);
  await sql`ALTER TABLE knowledge_links
    DROP CONSTRAINT IF EXISTS knowledge_links_to_knowledge_page_id_fkey,
    ALTER COLUMN to_knowledge_page_id SET NOT NULL,
    ADD CONSTRAINT knowledge_links_to_knowledge_page_id_fkey FOREIGN KEY(to_knowledge_page_id) REFERENCES knowledge_pages(id) ON DELETE CASCADE,
    ADD CONSTRAINT knowledge_links_type_check CHECK(link_type IN ('summary_mention','catalog_mention')),
    ADD CONSTRAINT knowledge_links_identity_unique UNIQUE(workspace_id,from_knowledge_page_id,to_knowledge_page_id,link_type),
    DROP COLUMN target_page_id, DROP COLUMN target_space_id,
    DROP COLUMN target_artifact_kind, DROP COLUMN target_canonical_key,
    DROP COLUMN compiler_run_id, DROP COLUMN compile_task_id`.execute(db);
  await sql`UPDATE knowledge_artifact_contributions c SET artifact=jsonb_set(c.artifact,'{links}',
    COALESCE((SELECT jsonb_agg(jsonb_build_object('linkType',l->>'linkType','linkText',coalesce(l->>'linkText',''),
      'toKnowledgePageId',l->>'toKnowledgePageId','inputSourceRefs',coalesce(l->'inputSourceRefs','[]'::jsonb)) ORDER BY ord)
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.artifact->'links')='array' THEN c.artifact->'links' ELSE '[]'::jsonb END) WITH ORDINALITY item(l,ord)
      WHERE l->>'linkType' IN ('summary_mention','catalog_mention') AND coalesce(l->>'isOpaque','false')<>'true'
        AND EXISTS(SELECT 1 FROM knowledge_pages p WHERE p.id::text=l->>'toKnowledgePageId' AND p.workspace_id=c.workspace_id AND p.space_id=c.space_id)
    ),'[]'::jsonb))`.execute(db);
}
