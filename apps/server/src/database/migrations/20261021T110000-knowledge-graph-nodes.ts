import { Kysely, sql } from 'kysely';

/** Final node/edge model. Existing migrations are immutable. */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`LOCK TABLE knowledge_graph_edges, knowledge_graph_edge_sources IN ACCESS EXCLUSIVE MODE`.execute(
    db,
  );
  await sql`CREATE TABLE knowledge_graph_nodes (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    owner_source_page_id uuid NOT NULL,
    canonical_key text NOT NULL CHECK(length(canonical_key)>0),
    name text NOT NULL CHECK(length(name)>0),
    type text NOT NULL CHECK(length(type)>0),
    alias jsonb NOT NULL CHECK(jsonb_typeof(alias)='array'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(workspace_id,space_id,owner_source_page_id,canonical_key),
    UNIQUE(workspace_id,space_id,id)
  )`.execute(db);
  // Each source owns its metadata. Do not union private names/aliases into
  // another source's row just because the canonical identity matches.
  await sql`INSERT INTO knowledge_graph_nodes(id,workspace_id,space_id,owner_source_page_id,canonical_key,name,type,alias)
    SELECT md5(jsonb_build_array(workspace_id,space_id,owner_source_page_id,canonical_key)::text)::uuid,
      workspace_id,space_id,owner_source_page_id,canonical_key,min(name),'unknown','[]'::jsonb
    FROM (
      SELECT workspace_id,space_id,owner_source_page_id,from_entity_key AS canonical_key,from_entity_name AS name FROM knowledge_graph_edges
      UNION ALL
      SELECT workspace_id,space_id,owner_source_page_id,to_entity_key,to_entity_name FROM knowledge_graph_edges
    ) endpoint GROUP BY workspace_id,space_id,owner_source_page_id,canonical_key`.execute(
    db,
  );
  await sql`ALTER TABLE knowledge_graph_edges ADD COLUMN from_node_id uuid, ADD COLUMN to_node_id uuid`.execute(
    db,
  );
  await sql`UPDATE knowledge_graph_edges e SET from_node_id=n.id FROM knowledge_graph_nodes n
    WHERE n.workspace_id=e.workspace_id AND n.space_id=e.space_id AND n.owner_source_page_id=e.owner_source_page_id AND n.canonical_key=e.from_entity_key`.execute(
    db,
  );
  await sql`UPDATE knowledge_graph_edges e SET to_node_id=n.id FROM knowledge_graph_nodes n
    WHERE n.workspace_id=e.workspace_id AND n.space_id=e.space_id AND n.owner_source_page_id=e.owner_source_page_id AND n.canonical_key=e.to_entity_key`.execute(
    db,
  );
  await sql`ALTER TABLE knowledge_graph_edges
    ALTER COLUMN from_node_id SET NOT NULL, ALTER COLUMN to_node_id SET NOT NULL,
    ADD CONSTRAINT knowledge_graph_edges_from_node_fk FOREIGN KEY(workspace_id,space_id,from_node_id) REFERENCES knowledge_graph_nodes(workspace_id,space_id,id),
    ADD CONSTRAINT knowledge_graph_edges_to_node_fk FOREIGN KEY(workspace_id,space_id,to_node_id) REFERENCES knowledge_graph_nodes(workspace_id,space_id,id),
    DROP COLUMN compiler_run_id, DROP COLUMN compile_task_id, DROP COLUMN owner_source_page_id,
    DROP COLUMN from_entity_key, DROP COLUMN from_entity_name,
    DROP COLUMN to_entity_key, DROP COLUMN to_entity_name`.execute(
    db,
  );
  await sql`CREATE INDEX idx_graph_nodes_identity ON knowledge_graph_nodes(workspace_id,space_id,canonical_key)`.execute(
    db,
  );
  await sql`CREATE INDEX idx_graph_nodes_owner ON knowledge_graph_nodes(workspace_id,space_id,owner_source_page_id)`.execute(
    db,
  );
  await sql`CREATE INDEX idx_graph_edges_from_node ON knowledge_graph_edges(workspace_id,space_id,from_node_id)`.execute(
    db,
  );
  await sql`CREATE INDEX idx_graph_edges_to_node ON knowledge_graph_edges(workspace_id,space_id,to_node_id)`.execute(
    db,
  );
}
