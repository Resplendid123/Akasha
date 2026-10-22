import { up as nodesMigration } from './migrations/20261021T110000-knowledge-graph-nodes';
import { buildEntityGraph } from '../ee/llm-wiki/compiler/entity-graph';
import { SemanticAnalysis } from '../ee/llm-wiki/compiler/semantic-compiler.schema';
import { createHash } from 'node:crypto';
import { CamelCasePlugin, Kysely, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as postgres from 'postgres';
import { up } from './migrations/20261021T100000-finalize-knowledge-relations';
import {
  discoverEntityEdges,
  mapEntityEvidence,
} from './repos/llm-wiki/entity-graph.queries';
import { KnowledgeCapsuleRepo } from './repos/llm-wiki/knowledge-capsule.repo';

const url = process.env.AKASHA_MIGRATION_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const W = '00000000-0000-4000-8000-000000000001',
  S = '00000000-0000-4000-8000-000000000002';
const A = '00000000-0000-4000-8000-000000000003',
  P = '00000000-0000-4000-8000-000000000004',
  Q = '00000000-0000-4000-8000-000000000005';
const E = '00000000-0000-4000-8000-000000000006',
  C = '00000000-0000-4000-8000-000000000007',
  D = '00000000-0000-4000-8000-000000000008';
function uuidFor(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '4' + h.slice(13, 16),
    ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) +
      h.slice(18, 20),
    h.slice(20, 32),
  ].join('-');
}
const analysis = {
  entities: [{ canonicalKey: 'alpha', name: 'Alpha' }],
  concepts: [{ canonicalKey: 'beta', name: 'Beta' }],
  relations: [
    {
      fromCanonicalKey: 'alpha',
      toCanonicalKey: 'beta',
      relation: 'depends_on',
      evidenceQuote: 'Alpha depends on Beta.',
    },
  ],
};
suite('final relation migration PostgreSQL', () => {
  let db: Kysely<any>, schema: string;
  jest.setTimeout(60000);
  beforeEach(async () => {
    db = new Kysely({
      dialect: new PostgresJSDialect({
        postgres: postgres(url!, { max: 1, onnotice: () => {} }),
      }),
    });
    schema = 'relation_final_' + process.pid + '_' + Date.now();
    await sql.raw('CREATE SCHEMA ' + schema).execute(db);
    await sql.raw('SET search_path TO ' + schema).execute(db);
    await sql`
    CREATE TABLE workspaces(id uuid PRIMARY KEY);
    CREATE TABLE spaces(id uuid PRIMARY KEY);
    CREATE TABLE knowledge_pages(id uuid PRIMARY KEY,workspace_id uuid,space_id uuid,page_type text,canonical_key text,title text,summary text,stale_at timestamptz);
    CREATE TABLE knowledge_page_sources(workspace_id uuid,knowledge_page_id uuid,source_page_id uuid,attachment_id uuid);
    CREATE TABLE knowledge_graph_edges(id uuid PRIMARY KEY,workspace_id uuid,space_id uuid,from_knowledge_page_id uuid NOT NULL REFERENCES knowledge_pages(id) ON DELETE CASCADE,to_knowledge_page_id uuid REFERENCES knowledge_pages(id) ON DELETE CASCADE,target_artifact_kind text,target_canonical_key text,is_dangling boolean,relation text,compiler_run_id text,compile_task_id text,stale_at timestamptz);
    CREATE TABLE knowledge_graph_edge_sources(workspace_id uuid,graph_edge_id uuid REFERENCES knowledge_graph_edges(id) ON DELETE CASCADE,source_page_id uuid,source_version text,content_hash text,source_range jsonb,quote_hash text,provenance_kind text,attachment_id uuid);
    CREATE TABLE knowledge_links(id uuid PRIMARY KEY,workspace_id uuid,space_id uuid,from_knowledge_page_id uuid REFERENCES knowledge_pages(id) ON DELETE CASCADE,to_knowledge_page_id uuid REFERENCES knowledge_pages(id) ON DELETE SET NULL,target_space_id uuid,target_artifact_kind text,target_canonical_key text,link_text text,link_type text,is_dangling boolean DEFAULT false,compiler_run_id text,compile_task_id text,stale_at timestamptz);
    CREATE TABLE knowledge_link_sources(workspace_id uuid,link_id uuid REFERENCES knowledge_links(id) ON DELETE CASCADE,source_page_id uuid,source_version text,content_hash text,source_range jsonb,quote_hash text,provenance_kind text,attachment_id uuid);
    CREATE TABLE knowledge_artifact_contributions(id uuid PRIMARY KEY,workspace_id uuid,space_id uuid,source_page_id uuid,source_version text,source_content_hash text,artifact_id uuid,artifact_kind text,canonical_key text,compiler_version text,prompt_version text,compiler_run_id text,compile_task_id text,artifact jsonb);
    CREATE TABLE knowledge_sources(id uuid PRIMARY KEY,workspace_id uuid,source_space_id uuid,source_page_id uuid,source_version text,content_hash text,extracted_text text,stale_at timestamptz,deleted_at timestamptz);
    CREATE TABLE knowledge_source_analyses(workspace_id uuid,space_id uuid,source_page_id uuid,source_version text,compiler_version text,prompt_version text,analysis jsonb);
    CREATE TABLE knowledge_source_chunks(id uuid,workspace_id uuid,source_id uuid,text text,content_hash text,quote_hash text,source_range jsonb);
    CREATE TABLE knowledge_chunks(id uuid PRIMARY KEY,workspace_id uuid,space_id uuid,knowledge_page_id uuid REFERENCES knowledge_pages(id) ON DELETE CASCADE,text text,content_hash text,stable_key text,chunk_role text,retrieval_channel text,start_offset int,end_offset int,compiler_run_id text,compile_task_id text,stale_at timestamptz,claim_id uuid);
    CREATE TABLE knowledge_chunk_sources(workspace_id uuid,chunk_id uuid REFERENCES knowledge_chunks(id) ON DELETE CASCADE,source_page_id uuid,source_version text,content_hash text,source_range jsonb,quote_hash text,provenance_kind text,attachment_id uuid);
    CREATE TABLE knowledge_parent_section_sources(attachment_id uuid);
    CREATE TABLE knowledge_space_compile_run_pages(image_job_id text);
    CREATE TABLE knowledge_compilation_attempts(result_quality text);
  `.execute(db);
    await sql`INSERT INTO workspaces VALUES(${W}::uuid)`.execute(db);
    await sql`INSERT INTO spaces VALUES(${S}::uuid)`.execute(db);
    await sql`INSERT INTO knowledge_pages VALUES(${P}::uuid,${W}::uuid,${S}::uuid,'source_summary',${A},'Notes',NULL,NULL),(${Q}::uuid,${W}::uuid,${S}::uuid,'entity','alpha','Alpha',NULL,NULL)`.execute(
      db,
    );
    await sql`INSERT INTO knowledge_page_sources VALUES(${W}::uuid,${P}::uuid,${A}::uuid,NULL),(${W}::uuid,${Q}::uuid,${A}::uuid,NULL)`.execute(
      db,
    );
    await sql`INSERT INTO knowledge_sources VALUES(${D}::uuid,${W}::uuid,${S}::uuid,${A}::uuid,'1','hash','Alpha depends on Beta.',NULL,NULL)`.execute(
      db,
    );
    await sql`INSERT INTO knowledge_source_analyses VALUES(${W}::uuid,${S}::uuid,${A}::uuid,'1','v1','p1',${JSON.stringify(analysis)}::text::jsonb)`.execute(
      db,
    );
    for (const [id, page, kind, key] of [
      [C, P, 'source_summary', A],
      [D, Q, 'entity', 'alpha'],
    ]) {
      const artifact = {
        artifactId: page,
        artifactKind: kind,
        canonicalKey: key,
        workspaceId: W,
        spaceId: S,
        title: kind === 'entity' ? 'Alpha' : 'Notes',
        contentMarkdown: 'Alpha depends on Beta.',
        links: [
          {
            linkType: 'arbitrary_model_link',
            toKnowledgePageId: Q,
            isDangling: true,
          },
        ],
        graphEdges: [{ targetCanonicalKey: 'beta' }],
        inputSourceRefs: [
          {
            workspaceId: W,
            spaceId: S,
            sourcePageId: A,
            sourceVersion: '1',
            contentHash: 'hash',
          },
        ],
      };
      await sql`INSERT INTO knowledge_artifact_contributions VALUES(${id}::uuid,${W}::uuid,${S}::uuid,${A}::uuid,'1','hash',${page}::uuid,${kind},${key},'v1','p1','run','task',${JSON.stringify(artifact)}::text::jsonb)`.execute(
        db,
      );
    }
    await sql`INSERT INTO knowledge_graph_edges VALUES(${E}::uuid,${W}::uuid,${S}::uuid,${Q}::uuid,NULL,NULL,'beta',true,'depends_on','run','task',NULL)`.execute(
      db,
    );
    await sql`INSERT INTO knowledge_graph_edge_sources VALUES(${W}::uuid,${E}::uuid,${A}::uuid,'1','hash',NULL,NULL,'synthesis_lineage',NULL)`.execute(
      db,
    );
    await sql`INSERT INTO knowledge_links(id,workspace_id,space_id,from_knowledge_page_id,to_knowledge_page_id,link_type,is_dangling) VALUES(${E}::uuid,${W}::uuid,${S}::uuid,${Q}::uuid,${P}::uuid,'secret_model_relation',true)`.execute(
      db,
    );
  });
  afterEach(async () => {
    await sql.raw('DROP SCHEMA ' + schema + ' CASCADE').execute(db);
    await db.destroy();
  });
  it('keeps endpoints the analysis lists spell differently, naming them by key', async () => {
    await sql`UPDATE knowledge_source_analyses SET analysis=jsonb_set(
      analysis,'{relations}',
      analysis->'relations'||jsonb_build_array(jsonb_build_object(
        'fromCanonicalKey','alpha',
        'toCanonicalKey','hockey.night.in.canada.advertising_control',
        'relation','controls advertising for',
        'evidenceQuote','Alpha depends on Beta.')))`.execute(db);
    await sql`UPDATE knowledge_source_analyses SET analysis=jsonb_set(
      analysis,'{concepts}',
      analysis->'concepts'||jsonb_build_array(jsonb_build_object(
        'canonicalKey','hockey_night_in_canada.advertising_control',
        'name','Advertising control','description','d','evidenceQuotes','[]'::jsonb)))`.execute(
      db,
    );
    await db.transaction().execute(async (trx) => {
      await up(trx);
      await nodesMigration(trx);
    });
    const node = (
      await sql<any>`SELECT name, canonical_key FROM knowledge_graph_nodes
        WHERE canonical_key='hockey.night.in.canada.advertising_control'`.execute(
        db,
      )
    ).rows;
    expect(node).toHaveLength(1);
    expect(node[0].name).toBe('hockey.night.in.canada.advertising_control');
    expect(
      (
        await sql<any>`SELECT count(*)::int AS n FROM knowledge_graph_nodes
          WHERE canonical_key='hockey_night_in_canada.advertising_control'`.execute(
          db,
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('streams past the insert batch size without losing rows', async () => {
    const sources = 12,
      chunksPerSource = 60;
    for (let s = 0; s < sources; s++) {
      const sourceId = uuidFor('src' + s),
        pageId = uuidFor('page' + s),
        sourcePageId = uuidFor('spage' + s);
      await sql`INSERT INTO knowledge_pages VALUES(${pageId}::uuid,${W}::uuid,${S}::uuid,'source_summary',${sourcePageId},'Bulk',NULL,NULL)`.execute(
        db,
      );
      await sql`INSERT INTO knowledge_page_sources VALUES(${W}::uuid,${pageId}::uuid,${sourcePageId}::uuid,NULL)`.execute(
        db,
      );
      await sql`INSERT INTO knowledge_sources VALUES(${sourceId}::uuid,${W}::uuid,${S}::uuid,${sourcePageId}::uuid,'1','hash','Alpha depends on Beta.',NULL,NULL)`.execute(
        db,
      );
      await sql`INSERT INTO knowledge_source_analyses VALUES(${W}::uuid,${S}::uuid,${sourcePageId}::uuid,'1','v1','p1',${JSON.stringify(analysis)}::text::jsonb)`.execute(
        db,
      );
      await sql`INSERT INTO knowledge_artifact_contributions VALUES(${uuidFor('contrib' + s)}::uuid,${W}::uuid,${S}::uuid,${sourcePageId}::uuid,'1','hash',${pageId}::uuid,'source_summary',${sourcePageId},'v1','p1','run','task',${JSON.stringify(
        {
          artifactId: pageId,
          artifactKind: 'source_summary',
          canonicalKey: sourcePageId,
          workspaceId: W,
          spaceId: S,
          title: 'Bulk',
          contentMarkdown: 'Alpha depends on Beta.',
          inputSourceRefs: [
            {
              workspaceId: W,
              spaceId: S,
              sourcePageId,
              sourceVersion: '1',
              contentHash: 'hash',
            },
          ],
        },
      )}::text::jsonb)`.execute(db);
      for (let c = 0; c < chunksPerSource; c++)
        await sql`INSERT INTO knowledge_source_chunks VALUES(${uuidFor('chunk' + s + '_' + c)}::uuid,${W}::uuid,${sourceId}::uuid,${'chunk text ' + s + '_' + c},${'sha256:c' + s + '_' + c},${'sha256:q' + s + '_' + c},${JSON.stringify(
          { startOffset: c, endOffset: c + 5 },
        )}::text::jsonb)`.execute(db);
    }
    await db.transaction().execute(async (trx) => {
      await up(trx);
      await nodesMigration(trx);
    });
    const counts = (
      await sql<any>`SELECT
        (SELECT count(*) FROM knowledge_chunks WHERE retrieval_channel='evidence') AS chunks,
        (SELECT count(*) FROM knowledge_chunk_sources) AS chunk_sources,
        (SELECT count(*) FROM knowledge_graph_edges) AS edges,
        (SELECT count(*) FROM knowledge_graph_nodes) AS nodes`.execute(db)
    ).rows[0];
    expect(Number(counts.chunks)).toBe(sources * chunksPerSource + 1);
    expect(Number(counts.chunk_sources)).toBe(sources * chunksPerSource + 1);
    expect(Number(counts.edges)).toBe(sources + 1);
    expect(Number(counts.nodes)).toBe((sources + 1) * 2);
    const orphans = (
      await sql<any>`SELECT count(*) AS n FROM knowledge_chunk_sources cs
        WHERE NOT EXISTS(SELECT 1 FROM knowledge_chunks c WHERE c.id=cs.chunk_id)`.execute(
        db,
      )
    ).rows[0];
    expect(Number(orphans.n)).toBe(0);
    const persisted = (
      await sql<any>`SELECT jsonb_array_length(artifact->'chunks') AS n
        FROM knowledge_artifact_contributions WHERE id=${uuidFor('contrib0')}::uuid`.execute(
        db,
      )
    ).rows[0];
    expect(Number(persisted.n)).toBe(chunksPerSource);
  });
  it('converts populated upstream schema directly to final relations and contribution JSON', async () => {
    await db.transaction().execute(async (trx) => {
      await up(trx);
      await nodesMigration(trx);
    });
    const edges = (
      await sql<any>`SELECT * FROM knowledge_graph_edges`.execute(db)
    ).rows;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      relation: 'depends_on',
      from_node_id: expect.any(String),
      to_node_id: expect.any(String),
    });
    const nodes = (
      await sql<any>`SELECT * FROM knowledge_graph_nodes`.execute(db)
    ).rows;
    expect(nodes).toHaveLength(2);
    expect(nodes.find((n) => n.id === edges[0].from_node_id)).toMatchObject({
      canonical_key: 'alpha',
      name: 'Alpha',
      type: 'unknown',
      alias: [],
    });
    expect(edges[0]).not.toHaveProperty('from_entity_key');
    expect(edges[0]).not.toHaveProperty('from_knowledge_page_id');
    expect(edges[0]).not.toHaveProperty('is_dangling');
    for(const field of ['compiler_run_id','compile_task_id','owner_source_page_id']) expect(edges[0]).not.toHaveProperty(field);
    expect(edges[0]).toHaveProperty('stale_at',null);
    const links = (await sql<any>`SELECT * FROM knowledge_links`.execute(db))
      .rows;
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      link_type: 'summary_mention',
      from_knowledge_page_id: P,
      to_knowledge_page_id: Q,
    });
    const artifacts = (
      await sql<any>`SELECT artifact FROM knowledge_artifact_contributions`.execute(
        db,
      )
    ).rows.map((r) => r.artifact);
    expect(
      artifacts.every(
        (a) => !('graphEdges' in a) && !('relationshipVersion' in a),
      ),
    ).toBe(true);
    expect(artifacts[0].links[0].linkType).toBe('summary_mention');
    const discovered = await discoverEntityEdges(db as never, {
      workspaceId: W,
      spaceIds: [S],
      knowledgePageIds: [Q],
      readableSourcePageIds: [A],
      limit: 20,
    });
    expect(discovered).toHaveLength(1);
    expect(discovered[0].from.canonicalKey).toBe('alpha');
    expect(discovered[0].to.canonicalKey).toBe('beta');
    const evidence = await mapEntityEvidence(db as never, {
      workspaceId: W,
      edges: discovered,
      limit: 20,
    });
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0].paths[0].inputSourceRefs[0].sourceRange).toEqual({
      startOffset: 0,
      endOffset: 22,
    });
    await sql`DELETE FROM knowledge_pages WHERE id=${Q}::uuid`.execute(db);
    expect(
      (await sql`SELECT id FROM knowledge_graph_edges`.execute(db)).rows,
    ).toHaveLength(1);
  });
  it('keeps stale dependencies stale and retains separate exact evidence ranges', async () => {
    await sql`UPDATE knowledge_sources SET stale_at=now()`.execute(db);
    await sql`UPDATE knowledge_source_analyses SET analysis=jsonb_set(analysis,'{relations}',analysis->'relations'||jsonb_build_array(jsonb_build_object('fromCanonicalKey','alpha','toCanonicalKey','beta','relation','depends_on','evidenceQuote','Beta')))`.execute(
      db,
    );
    await db.transaction().execute(async (trx) => {
      await up(trx);
      await nodesMigration(trx);
    });
    expect(
      (
        await sql<any>`SELECT * FROM knowledge_graph_edges`.execute(db)
      ).rows.every((e) => e.stale_at !== null),
    ).toBe(true);
    expect(
      (await sql`SELECT * FROM knowledge_graph_edges`.execute(db)).rows,
    ).toHaveLength(2);
    expect(
      await discoverEntityEdges(db as never, {
        workspaceId: W,
        spaceIds: [S],
        knowledgePageIds: [P],
        readableSourcePageIds: [A],
        limit: 20,
      }),
    ).toEqual([]);
  });
  it('refuses missing analyses without deleting or guessing old facts', async () => {
    await sql`DELETE FROM knowledge_source_analyses`.execute(db);
    await expect(db.transaction().execute((trx) => up(trx))).rejects.toThrow(
      'missing_or_ambiguous_analysis',
    );
    expect(
      (await sql`SELECT * FROM knowledge_graph_edges`.execute(db)).rows,
    ).toHaveLength(1);
    expect(
      (await sql`SELECT is_dangling FROM knowledge_links`.execute(db)).rows,
    ).toHaveLength(1);
  });
  it('does not split multi-source dependencies by inventing an owner', async () => {
    await sql`INSERT INTO knowledge_graph_edge_sources VALUES(${W}::uuid,${E}::uuid,${D}::uuid,'1','h',NULL,NULL,'synthesis_lineage')`.execute(
      db,
    );
    await expect(db.transaction().execute((trx) => up(trx))).rejects.toThrow(
      'ambiguous_owner',
    );
  });
  it('supports final source replacement, rollback, and independent-source ownership', async () => {
    await db.transaction().execute(async (trx) => {
      await up(trx);
      await nodesMigration(trx);
    });
    const runtime = db.withPlugin(new CamelCasePlugin());
    const repo = new KnowledgeCapsuleRepo(runtime as never);
    await runtime.transaction().execute((trx) =>
      repo.replaceSourceGraphEdges(
        {
          workspaceId: W,
          spaceId: S,
          sourcePageIds: [D],
          edges: [],
          sources: [],
        },
        trx as never,
      ),
    );
    expect(
      (await sql`SELECT id FROM knowledge_graph_edges`.execute(db)).rows,
    ).toHaveLength(1);
    await expect(
      runtime.transaction().execute(async (trx) => {
        await repo.replaceSourceGraphEdges(
          {
            workspaceId: W,
            spaceId: S,
            sourcePageIds: [A],
            edges: [],
            sources: [],
          },
          trx as never,
        );
        throw new Error('cancelled');
      }),
    ).rejects.toThrow('cancelled');
    expect(
      (await sql`SELECT id FROM knowledge_graph_edges`.execute(db)).rows,
    ).toHaveLength(1);
    await runtime.transaction().execute((trx) =>
      repo.replaceSourceGraphEdges(
        {
          workspaceId: W,
          spaceId: S,
          sourcePageIds: [A],
          edges: [],
          sources: [],
        },
        trx as never,
      ),
    );
    expect(
      (await sql`SELECT id FROM knowledge_graph_edges`.execute(db)).rows,
    ).toHaveLength(0);
    expect(
      (
        await sql`SELECT graph_edge_id FROM knowledge_graph_edge_sources`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(0);
  });
  it('keeps a partially readable multi-source edge out of traversal entirely', async () => {
    await db.transaction().execute(async (trx) => {
      await up(trx);
      await nodesMigration(trx);
    });
    await sql`INSERT INTO knowledge_graph_edge_sources(workspace_id,graph_edge_id,source_page_id,source_version,content_hash,provenance_kind)
    SELECT workspace_id,id,${D}::uuid,'1','private','source_evidence' FROM knowledge_graph_edges`.execute(
      db,
    );
    for (const seed of [Q, P])
      expect(
        await discoverEntityEdges(db as never, {
          workspaceId: W,
          spaceIds: [S],
          knowledgePageIds: [seed],
          readableSourcePageIds: [A],
          limit: 20,
        }),
      ).toEqual([]);
    expect(
      await discoverEntityEdges(db as never, {
        workspaceId: W,
        spaceIds: [S],
        knowledgePageIds: [P],
        readableSourcePageIds: [A, D],
        limit: 20,
      }),
    ).toHaveLength(1);
  });
  it('preserves old stale relations even when the source remains active', async () => {
    await sql`UPDATE knowledge_graph_edges SET stale_at=now()`.execute(db);
    await db.transaction().execute(async (trx) => {
      await up(trx);
      await nodesMigration(trx);
    });
    expect(
      (await sql<any>`SELECT stale_at FROM knowledge_graph_edges`.execute(db))
        .rows[0].stale_at,
    ).not.toBeNull();
  });
  it('publishes Stage 1 node metadata and enforces real node foreign keys', async () => {
    await db.transaction().execute(async (trx) => {
      await up(trx);
      await nodesMigration(trx);
    });
    const source = {
      workspaceId: W,
      spaceId: S,
      sourcePageId: A,
      sourceVersion: '2',
      contentHash: 'new',
      text: 'Alpha calls Beta',
      title: 'Source',
      references: [],
    };
    const extraction: SemanticAnalysis = {
      version: '1',
      synopsis: 'Summary',
      language: 'en',
      entities: [],
      concepts: [],
      claims: [],
      comparisons: [],
      contradictions: [],
      relations: [
        {
          from: {
            canonicalKey: 'alpha',
            name: 'Alpha',
            type: 'service',
            alias: ['Alpha API'],
          },
          to: {
            canonicalKey: 'beta',
            name: 'Beta',
            type: 'technique',
            alias: [],
          },
          relation: 'calls',
        },
      ],
    };
    const graph = buildEntityGraph({
      input: source,
      source,
      analysis: extraction,
      warnings: [],
    });
    const runtime = db.withPlugin(new CamelCasePlugin());
    const repo = new KnowledgeCapsuleRepo(runtime as never);
    const publication = {
      workspaceId: W,
      spaceId: S,
      sourcePageIds: [A],
      nodes: graph.graphNodes,
      edges: [
        {
          id: E,
          workspaceId: W,
          spaceId: S,
          fromNodeId: graph.graphEdges[0].from.id,
          toNodeId: graph.graphEdges[0].to.id,
          relation: 'calls',
          staleAt: null,
        },
      ],
      sources: [
        {
          workspaceId: W,
          graphEdgeId: E,
          sourcePageId: A,
          sourceVersion: '2',
          contentHash: 'new',
          quoteHash: null,
          sourceRange: null,
          provenanceKind: 'source_evidence',
        },
      ],
    };
    await runtime
      .transaction()
      .execute((trx) =>
        repo.replaceSourceGraphEdges(publication, trx as never),
      );
    const nodes = (
      await sql<any>`SELECT * FROM knowledge_graph_nodes ORDER BY name`.execute(
        db,
      )
    ).rows;
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({
      id: graph.graphNodes[0].id,
      name: 'Alpha',
      type: 'service',
      alias: ['Alpha API'],
    });
    const queried = await discoverEntityEdges(runtime as never, {
      workspaceId: W,
      spaceIds: [S],
      knowledgePageIds: [Q],
      readableSourcePageIds: [A],
      limit: 20,
    });
    expect(queried[0].from).toMatchObject({
      id: graph.graphNodes[0].id,
      type: 'service',
      alias: ['Alpha API'],
    });
    await expect(
      sql`UPDATE knowledge_graph_edges SET from_node_id=${D}::uuid WHERE id=${E}::uuid`.execute(
        db,
      ),
    ).rejects.toThrow();
    await expect(
      sql`DELETE FROM knowledge_graph_nodes WHERE id=${graph.graphNodes[0].id}::uuid`.execute(
        db,
      ),
    ).rejects.toThrow();
    await sql`INSERT INTO spaces VALUES(${D}::uuid)`.execute(db);
    await sql`INSERT INTO knowledge_graph_nodes(id,workspace_id,space_id,owner_source_page_id,canonical_key,name,type,alias) VALUES(${D}::uuid,${W}::uuid,${D}::uuid,${A}::uuid,'other','Other','service','[]')`.execute(
      db,
    );
    await expect(
      sql`UPDATE knowledge_graph_edges SET from_node_id=${D}::uuid WHERE id=${E}::uuid`.execute(
        db,
      ),
    ).rejects.toThrow();
    await expect(
      runtime.transaction().execute(async (trx) => {
        await repo.replaceSourceGraphEdges(
          { ...publication, nodes: [], edges: [], sources: [] },
          trx as never,
        );
        throw new Error('cancelled');
      }),
    ).rejects.toThrow('cancelled');
    expect(
      (
        await sql`SELECT id FROM knowledge_graph_nodes WHERE space_id=${S}::uuid`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(2);
    await runtime
      .transaction()
      .execute((trx) =>
        repo.replaceSourceGraphEdges(
          { ...publication, nodes: [], edges: [], sources: [] },
          trx as never,
        ),
      );
    expect(
      (
        await sql`SELECT id FROM knowledge_graph_nodes WHERE space_id=${S}::uuid`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await sql`SELECT id FROM knowledge_graph_nodes WHERE space_id=${D}::uuid`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(1);
  });
});
