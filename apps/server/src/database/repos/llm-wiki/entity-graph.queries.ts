import { sql } from 'kysely';
import { KyselyDB, KyselyTransaction } from '../../types/kysely.types';
import {
  EntityGraphTraversalEdge,
  EntityGraphPath,
} from '../../../ee/llm-wiki/types/entity-graph.types';

/** Internal discovery. Authorize every dependency before using endpoint names. */
export async function discoverEntityEdges(
  db: KyselyDB | KyselyTransaction,
  input: {
    workspaceId: string;
    spaceIds: string[];
    knowledgePageIds: string[];
    readableSourcePageIds: string[];
    limit: number;
  },
): Promise<EntityGraphTraversalEdge[]> {
  if (
    !input.spaceIds.length ||
    !input.knowledgePageIds.length ||
    !input.readableSourcePageIds.length ||
    input.limit <= 0
  )
    return [];
  const result = await sql<EntityGraphTraversalEdge>`
    WITH entity_edge AS (
      SELECT e.*, fn.canonical_key AS from_entity_key, fn.name AS from_entity_name,fn.type AS from_type,fn.alias AS from_alias,
        tn.canonical_key AS to_entity_key, tn.name AS to_entity_name,tn.type AS to_type,tn.alias AS to_alias
      FROM knowledge_graph_edges e
      JOIN knowledge_graph_nodes fn ON fn.id=e.from_node_id AND fn.workspace_id=e.workspace_id AND fn.space_id=e.space_id
      JOIN knowledge_graph_nodes tn ON tn.id=e.to_node_id AND tn.workspace_id=e.workspace_id AND tn.space_id=e.space_id
    ), seed_pages AS (
      SELECT p.* FROM knowledge_pages p
      WHERE p.workspace_id = ${input.workspaceId}::uuid AND p.space_id = ANY(${input.spaceIds}::uuid[])
        AND p.id = ANY(${input.knowledgePageIds}::uuid[]) AND p.stale_at IS NULL
        AND EXISTS (SELECT 1 FROM knowledge_page_sources ps WHERE ps.workspace_id=p.workspace_id AND ps.knowledge_page_id=p.id)
        AND NOT EXISTS (SELECT 1 FROM knowledge_page_sources ps WHERE ps.workspace_id=p.workspace_id AND ps.knowledge_page_id=p.id AND NOT(ps.source_page_id=ANY(${input.readableSourcePageIds}::uuid[])))
    ), seed_endpoints AS (
      SELECT e.space_id, endpoint.key
      FROM entity_edge e
      CROSS JOIN LATERAL (VALUES (e.from_entity_key),(e.to_entity_key)) endpoint(key)
      WHERE e.workspace_id=${input.workspaceId}::uuid AND e.space_id=ANY(${input.spaceIds}::uuid[]) AND e.stale_at IS NULL
        AND endpoint.key IS NOT NULL
        AND EXISTS (SELECT 1 FROM knowledge_graph_edge_sources es JOIN knowledge_page_sources ps ON ps.workspace_id=es.workspace_id AND ps.source_page_id=es.source_page_id JOIN seed_pages p ON p.id=ps.knowledge_page_id AND p.space_id=e.space_id WHERE es.workspace_id=e.workspace_id AND es.graph_edge_id=e.id)
        AND NOT EXISTS (SELECT 1 FROM knowledge_graph_edge_sources es WHERE es.workspace_id=e.workspace_id AND es.graph_edge_id=e.id AND NOT(es.source_page_id=ANY(${input.readableSourcePageIds}::uuid[])))
      ORDER BY space_id, key LIMIT 64
    )
    SELECT e.id, e.workspace_id AS "workspaceId", e.space_id AS "spaceId",
      jsonb_build_object('id',e.from_node_id,'type',e.from_type,'alias',e.from_alias,'canonicalKey',e.from_entity_key,'name',e.from_entity_name) AS "from",
      e.relation, jsonb_build_object('id',e.to_node_id,'type',e.to_type,'alias',e.to_alias,'canonicalKey',e.to_entity_key,'name',e.to_entity_name) AS "to",
      'semantic' AS type, 1::float8 AS weight,
      array_agg(DISTINCT es.source_page_id) AS "sourcePageIds",
      jsonb_agg(jsonb_build_object('workspaceId',es.workspace_id,'spaceId',e.space_id,'sourcePageId',es.source_page_id,'sourceVersion',es.source_version,'contentHash',es.content_hash,'sourceRange',es.source_range,'quoteHash',es.quote_hash)) AS "inputSourceRefs"
    FROM entity_edge e
    JOIN knowledge_graph_edge_sources es ON es.workspace_id=e.workspace_id AND es.graph_edge_id=e.id
    WHERE e.workspace_id=${input.workspaceId}::uuid AND e.space_id=ANY(${input.spaceIds}::uuid[]) AND e.stale_at IS NULL
      AND e.from_entity_key IS NOT NULL AND e.to_entity_key IS NOT NULL
      AND EXISTS(SELECT 1 FROM seed_endpoints s WHERE s.space_id=e.space_id AND (s.key=e.from_entity_key OR s.key=e.to_entity_key))
    GROUP BY e.id,e.workspace_id,e.space_id,e.from_node_id,e.to_node_id,e.from_type,e.from_alias,e.from_entity_key,e.from_entity_name,e.to_type,e.to_alias,e.to_entity_key,e.to_entity_name,e.relation ORDER BY e.id LIMIT ${Math.min(input.limit, 256)}
  `.execute(db);
  return result.rows;
}

export async function mapEntityEvidence(
  db: KyselyDB | KyselyTransaction,
  input: {
    workspaceId: string;
    edges: EntityGraphTraversalEdge[];
    limit: number;
  },
): Promise<
  Array<{ chunkId: string; knowledgePageId: string; paths: EntityGraphPath[] }>
> {
  if (!input.edges.length || input.limit <= 0) return [];
  // Input edges are fully authorized; final chunk authorization remains required.
  const result = await sql<{
    chunkId: string;
    knowledgePageId: string;
    edgeId: string;
  }>`
    WITH edge AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(input.edges)}::text::jsonb) AS e(id uuid,"spaceId" uuid,"from" jsonb,"to" jsonb,"inputSourceRefs" jsonb))
    SELECT DISTINCT c.id AS "chunkId", c.knowledge_page_id AS "knowledgePageId", t.id AS "edgeId"
    FROM edge t JOIN knowledge_chunks c ON c.workspace_id=${input.workspaceId}::uuid AND c.space_id=t."spaceId" AND c.stale_at IS NULL
    JOIN knowledge_pages p ON p.workspace_id=c.workspace_id AND p.space_id=c.space_id AND p.id=c.knowledge_page_id AND p.stale_at IS NULL
    WHERE c.retrieval_channel='evidence' AND c.stable_key LIKE 'source-evidence:%' AND EXISTS (
        SELECT 1 FROM knowledge_chunk_sources cs CROSS JOIN LATERAL jsonb_array_elements(t."inputSourceRefs") ref
        WHERE cs.workspace_id=c.workspace_id AND cs.chunk_id=c.id AND cs.source_page_id=(ref->>'sourcePageId')::uuid
          AND cs.source_version=ref->>'sourceVersion' AND cs.content_hash=ref->>'contentHash'
          AND (ref->'sourceRange' IS NULL OR ref->'sourceRange'='null'::jsonb OR
            ((cs.source_range->>'startOffset')::int < (ref->'sourceRange'->>'endOffset')::int AND (cs.source_range->>'endOffset')::int > (ref->'sourceRange'->>'startOffset')::int))
      )
    ORDER BY "chunkId", "edgeId" LIMIT ${Math.min(input.limit, 2000)}
  `.execute(db);
  const byId = new Map(input.edges.map((edge) => [edge.id, edge]));
  const chunks = new Map<
    string,
    { chunkId: string; knowledgePageId: string; paths: EntityGraphPath[] }
  >();
  for (const row of result.rows) {
    const edge = byId.get(row.edgeId)!;
    const chunk = chunks.get(row.chunkId) ?? {
      chunkId: row.chunkId,
      knowledgePageId: row.knowledgePageId,
      paths: [],
    };
    chunk.paths.push({
      edgeId: edge.id,
      relation: edge.relation,
      from: edge.from,
      to: edge.to,
      inputSourceRefs: edge.inputSourceRefs,
    });
    chunks.set(row.chunkId, chunk);
  }
  return [...chunks.values()];
}
