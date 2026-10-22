import { Kysely, RawBuilder, sql } from 'kysely';
import { createHash } from 'node:crypto';

type Row = Record<string, any>;
type Node = { canonicalKey: string; name: string };
const BATCH = 500;
const normalize = (value: string) =>
  value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
function uuid(value: string) {
  const h = hash(value);
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '4' + h.slice(13, 16),
    ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) +
      h.slice(18, 20),
    h.slice(20, 32),
  ].join('-');
}
function groupBy<T>(rows: T[], id: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const existing = grouped.get(id(row));
    if (existing) existing.push(row);
    else grouped.set(id(row), [row]);
  }
  return grouped;
}
function step(message: string): void {
  console.log(`[finalize-knowledge-relations] ${message}`);
}
function progress(label: string, done: number, total: number): void {
  step(`${label} ${done}/${total}`);
}
async function insertBatched(
  db: Kysely<any>,
  target: string,
  rows: Array<RawBuilder<unknown>>,
  label?: string,
): Promise<void> {
  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH);
    await sql`${sql.raw('INSERT INTO ' + target)} VALUES ${sql.join(batch)}`.execute(
      db,
    );
    if (label)
      progress(label, Math.min(start + BATCH, rows.length), rows.length);
  }
}
function streamingInserter(db: Kysely<any>, target: string, label: string) {
  let pending: Array<RawBuilder<unknown>> = [];
  let written = 0;
  return {
    async push(row: RawBuilder<unknown>): Promise<void> {
      pending.push(row);
      if (pending.length < BATCH) return;
      const batch = pending;
      pending = [];
      await insertBatched(db, target, batch);
      written += batch.length;
      step(`${label} ${written} written`);
    },
    async flush(): Promise<void> {
      const batch = pending;
      pending = [];
      await insertBatched(db, target, batch);
      written += batch.length;
      step(`${label} ${written} written (done)`);
    },
  };
}
async function patchContributionArtifacts(
  db: Kysely<any>,
  rows: Array<[string, string]>,
): Promise<void> {
  if (!rows.length) return;
  await sql`UPDATE knowledge_artifact_contributions AS c SET artifact=patch.artifact::jsonb
    FROM (VALUES ${sql.join(rows.map(([id, artifact]) => sql`(${id}::uuid,${artifact})`))}) AS patch(id,artifact)
    WHERE c.id=patch.id`.execute(db);
  step(`contribution artifacts ${rows.length} patched`);
}

/** One-way atomic migration after the v1 baseline. Run with writers stopped; the migrator supplies
 * the transaction. Historical conversion exists only here. Missing analysis
 * fails preflight; page titles are never fabricated into entity identities. */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      'LOCK TABLE knowledge_graph_edges, knowledge_graph_edge_sources, knowledge_links, knowledge_link_sources, knowledge_artifact_contributions, knowledge_sources, knowledge_source_analyses, knowledge_pages IN ACCESS EXCLUSIVE MODE',
    )
    .execute(db);
  // JSON text keeps this migration independent of a caller's CamelCasePlugin.
  async function read(table: string, columns = '*'): Promise<Row[]> {
    const result = await sql<{
      data: string;
    }>`SELECT row_to_json(t)::text AS data FROM (SELECT ${sql.raw(columns)} FROM ${sql.table(table)}) t`.execute(
      db,
    );
    return result.rows.map((row) => JSON.parse(row.data));
  }
  async function readSourceChunks(
    workspaceId: string,
    sourceId: string,
  ): Promise<Row[]> {
    const result = await sql<{
      data: string;
    }>`SELECT row_to_json(t)::text AS data FROM (
      SELECT id,text,content_hash,quote_hash,source_range FROM knowledge_source_chunks
      WHERE workspace_id=${workspaceId}::uuid AND source_id=${sourceId}::uuid
    ) t`.execute(db);
    return result.rows.map((row) => JSON.parse(row.data));
  }
  async function readSourceText(id: string): Promise<string | null> {
    const result = await sql<{
      extracted_text: string | null;
    }>`SELECT extracted_text FROM knowledge_sources WHERE id=${id}::uuid`.execute(
      db,
    );
    const text = result.rows[0]?.extracted_text;
    return typeof text === 'string' ? text : null;
  }
  step('reading existing relations and contributions');
  const contributions = await read('knowledge_artifact_contributions'),
    pages = await read('knowledge_pages');
  const oldEdges = await read('knowledge_graph_edges'),
    oldRefs = await read('knowledge_graph_edge_sources');
  const allSources = await read(
    'knowledge_sources',
    'id,workspace_id,source_space_id,source_page_id,source_version,content_hash,stale_at,deleted_at',
  );
  const allAnalyses = await read('knowledge_source_analyses');
  step(
    `read ${contributions.length} contributions, ${oldEdges.length} edges, ${allSources.length} sources`,
  );
  const sourceById = new Map(
    allSources.map((source) => [
      [
        source.workspace_id,
        source.source_space_id,
        source.source_page_id,
        source.source_version,
        source.content_hash,
      ].join(':'),
      source,
    ]),
  );
  const scopes = new Map<string, Row>();
  for (const c of contributions) {
    const id = c.workspace_id + ':' + c.space_id + ':' + c.source_page_id,
      prior = scopes.get(id);
    if (
      prior &&
      (prior.source_version !== c.source_version ||
        prior.source_content_hash !== c.source_content_hash)
    )
      throw new Error(
        'relation_migration_mixed_source_versions:' + c.source_page_id,
      );
    scopes.set(id, c);
  }
  for (const edge of oldEdges) {
    const refs = oldRefs.filter(
      (r) =>
        r.workspace_id === edge.workspace_id && r.graph_edge_id === edge.id,
    );
    if (!refs.length)
      throw new Error('relation_migration_missing_edge_evidence:' + edge.id);
    if (new Set(refs.map((r) => r.source_page_id)).size !== 1)
      throw new Error('relation_migration_ambiguous_owner:' + edge.id);
    for (const ref of refs) {
      const id =
        edge.workspace_id + ':' + edge.space_id + ':' + ref.source_page_id;
      if (!scopes.has(id))
        scopes.set(id, {
          workspace_id: edge.workspace_id,
          space_id: edge.space_id,
          source_page_id: ref.source_page_id,
          source_version: ref.source_version,
          source_content_hash: ref.content_hash,
        });
    }
  }
  let keyNamedEndpoints = 0;
  const prepared: Array<{
    scope: Row;
    source: Row;
    nodes: Map<string, Node[]>;
    edges: Row[];
  }> = [];
  step(`preflighting ${scopes.size} source scopes`);
  let preflighted = 0;
  for (const scope of scopes.values()) {
    if (++preflighted % 100 === 0 || preflighted === scopes.size)
      progress('preflight', preflighted, scopes.size);
    const source = sourceById.get(
      [
        scope.workspace_id,
        scope.space_id,
        scope.source_page_id,
        scope.source_version,
        scope.source_content_hash,
      ].join(':'),
    );
    const extractedText = source ? await readSourceText(source.id) : null;
    if (!source || extractedText === null)
      throw new Error(
        'relation_migration_missing_source:' + scope.source_page_id,
      );
    const matching = allAnalyses.filter(
      (a) =>
        a.workspace_id === scope.workspace_id &&
        a.space_id === scope.space_id &&
        a.source_page_id === scope.source_page_id &&
        a.source_version === scope.source_version &&
        (!scope.compiler_version ||
          a.compiler_version === scope.compiler_version) &&
        (!scope.prompt_version || a.prompt_version === scope.prompt_version),
    );
    const distinct = new Map(
      matching.map((a) => [JSON.stringify(a.analysis), a.analysis]),
    );
    if (distinct.size !== 1)
      throw new Error(
        'relation_migration_missing_or_ambiguous_analysis:' +
          scope.source_page_id,
      );
    const analysis = distinct.values().next().value as Row;
    if (
      !Array.isArray(analysis.entities) ||
      !Array.isArray(analysis.concepts) ||
      !Array.isArray(analysis.relations)
    )
      throw new Error(
        'relation_migration_invalid_analysis:' + scope.source_page_id,
      );
    const unnamedEndpoints = new Set<string>();
    const nodes = new Map<string, Node[]>();
    for (const node of [...analysis.entities, ...analysis.concepts]) {
      if (typeof node.canonicalKey !== 'string' || !node.canonicalKey.trim())
        throw new Error(
          'relation_migration_invalid_node:' + scope.source_page_id,
        );
      const canonicalKey = normalize(node.canonicalKey);
      nodes.set(canonicalKey, [
        ...(nodes.get(canonicalKey) ?? []),
        {
          canonicalKey,
          name: typeof node.name === 'string' ? node.name : '',
        },
      ]);
    }
    // Nodes come from relation endpoints, exactly as the compiler builds them.
    // The analysis lists only supply a display name, and a model that spells an
    // endpoint key differently there leaves none; the key is then the only
    // source-grounded name available, and inventing a prettier one would be a
    // guess.
    function endpoint(relation: Row, side: 'from' | 'to'): Node {
      const ref = relation[side],
        raw = ref?.canonicalKey ?? relation[side + 'CanonicalKey'];
      if (typeof raw !== 'string' || !raw.trim())
        throw new Error(
          'relation_migration_unknown_endpoint:' + scope.source_page_id,
        );
      const canonicalKey = normalize(raw);
      const matches = nodes.get(canonicalKey) ?? [];
      const named = matches
        .map((node) => node.name)
        .filter((name) => name.trim())
        .sort();
      if (!named.length) unnamedEndpoints.add(canonicalKey);
      return { canonicalKey, name: named[0] ?? raw.trim() };
    }
    const edges: Row[] = [];
    for (const relation of analysis.relations) {
      const from = endpoint(relation, 'from'),
        to = endpoint(relation, 'to');
      if (typeof relation.relation !== 'string' || !relation.relation.trim())
        throw new Error('relation_migration_invalid_predicate');
      const quote = relation.evidenceQuote,
        start = typeof quote === 'string' ? extractedText.indexOf(quote) : -1;
      const ref: Row = {
        workspaceId: scope.workspace_id,
        spaceId: scope.space_id,
        sourcePageId: scope.source_page_id,
        sourceVersion: source.source_version,
        contentHash: source.content_hash,
        ...(start >= 0
          ? {
              sourceRange: {
                startOffset: start,
                endOffset: start + quote.length,
              },
              quoteHash: 'sha256:' + hash(quote),
            }
          : {}),
      };
      const id = uuid(
        JSON.stringify([
          scope.workspace_id,
          scope.space_id,
          scope.source_page_id,
          from.canonicalKey,
          relation.relation,
          to.canonicalKey,
          [
            [
              ref.workspaceId,
              ref.spaceId,
              ref.sourcePageId,
              ref.sourceVersion,
              ref.contentHash,
              ref.sourceRange?.startOffset ?? null,
              ref.sourceRange?.endOffset ?? null,
              ref.quoteHash ?? null,
            ],
          ],
        ]),
      );
      if (!edges.some((e) => e.id === id))
        edges.push({ id, from, to, relation: relation.relation, ref });
    }
    if (unnamedEndpoints.size) keyNamedEndpoints += unnamedEndpoints.size;
    prepared.push({ scope, source, nodes, edges });
  }
  if (keyNamedEndpoints)
    console.warn(
      `[finalize-knowledge-relations] ${keyNamedEndpoints} relation endpoints had no matching entities/concepts entry and kept their canonical key as the display name. Recompiling those sources replaces it with the extracted name.`,
    );
  await sql`DELETE FROM knowledge_graph_edges`.execute(db);
  await sql`ALTER TABLE knowledge_graph_edges
    DROP COLUMN from_knowledge_page_id, DROP COLUMN to_knowledge_page_id,
    DROP COLUMN target_artifact_kind, DROP COLUMN target_canonical_key, DROP COLUMN is_dangling,
    ADD COLUMN owner_source_page_id uuid NOT NULL,
    ADD COLUMN from_entity_key text NOT NULL, ADD COLUMN from_entity_name text NOT NULL,
    ADD COLUMN to_entity_key text NOT NULL, ADD COLUMN to_entity_name text NOT NULL`.execute(
    db,
  );
  const oldEdgeById = new Map(oldEdges.map((edge) => [edge.id, edge]));
  const staleByOwner = new Map<string, Map<string, string>>();
  for (const ref of oldRefs) {
    const owner = ref.workspace_id + ':' + ref.source_page_id;
    const edge = oldEdgeById.get(ref.graph_edge_id);
    if (!edge?.stale_at) continue;
    const byRelation = staleByOwner.get(owner) ?? new Map<string, string>();
    if (!byRelation.has(edge.relation))
      byRelation.set(edge.relation, edge.stale_at);
    staleByOwner.set(owner, byRelation);
  }
  const edgeRows: Array<RawBuilder<unknown>> = [];
  const edgeSourceRows: Array<RawBuilder<unknown>> = [];
  for (const { scope, source, edges } of prepared)
    for (const e of edges) {
      const previousStale = staleByOwner
        .get(scope.workspace_id + ':' + scope.source_page_id)
        ?.get(e.relation);
      const stale =
        source.stale_at ?? source.deleted_at ?? previousStale ?? null;
      edgeRows.push(
        sql`(${e.id}::uuid,${scope.workspace_id}::uuid,${scope.space_id}::uuid,${scope.source_page_id}::uuid,${e.from.canonicalKey},${e.from.name},${e.to.canonicalKey},${e.to.name},${e.relation},${scope.compiler_run_id ?? 'relation-migration'},${scope.compile_task_id ?? 'relation-migration'},${stale})`,
      );
      edgeSourceRows.push(
        sql`(${scope.workspace_id}::uuid,${e.id}::uuid,${scope.source_page_id}::uuid,${source.source_version},${source.content_hash},${JSON.stringify(e.ref.sourceRange ?? null)}::text::jsonb,${e.ref.quoteHash ?? null},'source_evidence')`,
      );
    }
  await insertBatched(
    db,
    'knowledge_graph_edges(id,workspace_id,space_id,owner_source_page_id,from_entity_key,from_entity_name,to_entity_key,to_entity_name,relation,compiler_run_id,compile_task_id,stale_at)',
    edgeRows,
    'edges',
  );
  await insertBatched(
    db,
    'knowledge_graph_edge_sources(workspace_id,graph_edge_id,source_page_id,source_version,content_hash,source_range,quote_hash,provenance_kind)',
    edgeSourceRows,
    'edge evidence',
  );

  const pageById = new Map(pages.map((page) => [page.id, page]));
  const summaryByScope = new Map(
    contributions
      .filter((c) => c.artifact_kind === 'source_summary')
      .map((c) => [
        c.workspace_id + ':' + c.space_id + ':' + c.source_page_id,
        c,
      ]),
  );
  step(`materializing evidence chunks for ${prepared.length} sources`);
  const chunkInserter = streamingInserter(
    db,
    'knowledge_chunks(id,workspace_id,space_id,knowledge_page_id,text,content_hash,stable_key,chunk_role,retrieval_channel,start_offset,end_offset,compiler_run_id,compile_task_id,stale_at)',
    'chunks',
  );
  const chunkSourceRows: Array<RawBuilder<unknown>> = [];
  for (const { scope, source } of prepared) {
    const summary = summaryByScope.get(
      scope.workspace_id + ':' + scope.space_id + ':' + scope.source_page_id,
    );
    if (!summary) continue;
    const summaryPage = pageById.get(summary.artifact_id);
    const ref = {
      workspaceId: scope.workspace_id,
      spaceId: scope.space_id,
      sourcePageId: scope.source_page_id,
      sourceVersion: source.source_version,
      contentHash: source.content_hash,
    };
    const chunks = await readSourceChunks(scope.workspace_id, source.id);
    const extractedText = (await readSourceText(source.id)) ?? '';
    if (!chunks.length && extractedText.trim()) {
      for (let offset = 0; offset < extractedText.length; offset += 1800) {
        const text = extractedText.slice(offset, offset + 2000);
        chunks.push({
          id: uuid(source.id + ':' + offset),
          text,
          content_hash: 'sha256:' + hash(text),
          quote_hash: 'sha256:' + hash(text),
          source_range: {
            startOffset: offset,
            endOffset: offset + text.length,
          },
        });
      }
    }
    for (const chunk of chunks) {
      const range = chunk.source_range;
      const stableKey = 'source-evidence:' + chunk.id,
        id = uuid(summary.artifact_id + ':' + stableKey);
      const sourceRef = {
        ...ref,
        ...(range ? { sourceRange: range } : {}),
        ...(chunk.quote_hash ? { quoteHash: chunk.quote_hash } : {}),
      };
      summary.artifact.chunks ??= [];
      summary.artifact.chunks.push({
        text: chunk.text,
        contentHash: chunk.content_hash,
        stableKey,
        parentStableKey: null,
        chunkRole: 'standalone',
        retrievalChannel: 'evidence',
        startOffset: range?.startOffset ?? null,
        endOffset: range?.endOffset ?? null,
        inputSourceRefs: [sourceRef],
      });
      await chunkInserter.push(
        sql`(${id}::uuid,${scope.workspace_id}::uuid,${scope.space_id}::uuid,${summary.artifact_id}::uuid,${chunk.text},${chunk.content_hash},${stableKey},'standalone','evidence',${range?.startOffset ?? null},${range?.endOffset ?? null},${summary.compiler_run_id},${summary.compile_task_id},${summaryPage?.stale_at ?? source.stale_at ?? null})`,
      );
      chunkSourceRows.push(
        sql`(${scope.workspace_id}::uuid,${id}::uuid,${scope.source_page_id}::uuid,${source.source_version},${source.content_hash},${JSON.stringify(range ?? null)}::text::jsonb,${chunk.quote_hash ?? null},'source_evidence')`,
      );
    }
  }
  await chunkInserter.flush();
  await insertBatched(
    db,
    'knowledge_chunk_sources(workspace_id,chunk_id,source_page_id,source_version,content_hash,source_range,quote_hash,provenance_kind)',
    chunkSourceRows,
    'chunk evidence',
  );
  // Regenerate deterministic links; model links cannot be distinguished by
  // their relation label. Thus opaque/blocked historical links cannot reappear.
  step(`regenerating links for ${contributions.length} contributions`);
  await sql`DELETE FROM knowledge_links`.execute(db);
  await sql`ALTER TABLE knowledge_links DROP COLUMN is_dangling`.execute(db);
  const contributionsByScope = groupBy(
    contributions,
    (c) => c.workspace_id + ':' + c.space_id + ':' + c.source_page_id,
  );
  const activePagesBySpace = groupBy(
    pages.filter((page) => !page.stale_at),
    (page) => page.workspace_id + ':' + page.space_id,
  );
  const linkRows: Array<RawBuilder<unknown>> = [];
  const linkSourceRows: Array<RawBuilder<unknown>> = [];
  const contributionArtifacts: Array<[string, string]> = [];
  for (const c of contributions) {
    const artifact = { ...c.artifact };
    delete artifact.graphEdges;
    delete artifact.relationshipVersion;
    const local =
      contributionsByScope.get(
        c.workspace_id + ':' + c.space_id + ':' + c.source_page_id,
      ) ?? [];
    const catalog =
      activePagesBySpace.get(c.workspace_id + ':' + c.space_id) ?? [];
    const localIds = new Set(local.map((item) => item.artifact_id));
    const targets = new Map(
      catalog.map((p) => [
        p.id,
        { id: p.id, title: p.title, kind: p.page_type, key: p.canonical_key },
      ]),
    );
    for (const other of local)
      targets.set(other.artifact_id, {
        id: other.artifact_id,
        title: other.artifact.title,
        kind: other.artifact_kind,
        key: other.canonical_key,
      });
    const links: Row[] = [];
    for (const target of targets.values()) {
      if (target.id === c.artifact_id) continue;
      const summary =
        c.artifact_kind === 'source_summary' && localIds.has(target.id);
      const title = target.title?.trim();
      if (
        !summary &&
        (!title ||
          title.length < 2 ||
          !exactTitle(artifact.title + '\n' + artifact.contentMarkdown, title))
      )
        continue;
      if (!summary && links.length >= 12) continue;
      links.push({
        linkType: summary ? 'summary_mention' : 'catalog_mention',
        linkText: title,
        targetSpaceId: c.space_id,
        targetArtifactKind: target.kind,
        targetCanonicalKey: target.key,
        toKnowledgePageId: target.id,
        isOpaque: false,
        inputSourceRefs: artifact.inputSourceRefs,
      });
    }
    artifact.links = links;
    contributionArtifacts.push([c.id, JSON.stringify(artifact)]);
    delete c.artifact.chunks;
    if (contributionArtifacts.length >= BATCH) {
      await patchContributionArtifacts(db, contributionArtifacts.splice(0));
    }
    const page = pageById.get(c.artifact_id);
    for (const [index, link] of links.entries()) {
      const id = uuid(c.id + ':link:' + index);
      linkRows.push(
        sql`(${id}::uuid,${c.workspace_id}::uuid,${c.space_id}::uuid,${c.artifact_id}::uuid,${link.toKnowledgePageId}::uuid,${c.space_id}::uuid,${link.targetArtifactKind},${link.targetCanonicalKey},${link.linkText},${link.linkType},${c.compiler_run_id},${c.compile_task_id},${page?.stale_at ?? null})`,
      );
      for (const ref of artifact.inputSourceRefs ?? [])
        linkSourceRows.push(
          sql`(${c.workspace_id}::uuid,${id}::uuid,${ref.sourcePageId}::uuid,${ref.sourceVersion},${ref.contentHash},${JSON.stringify(ref.sourceRange ?? null)}::text::jsonb,${ref.quoteHash ?? null},'synthesis_lineage')`,
        );
    }
  }
  await insertBatched(
    db,
    'knowledge_links(id,workspace_id,space_id,from_knowledge_page_id,to_knowledge_page_id,target_space_id,target_artifact_kind,target_canonical_key,link_text,link_type,compiler_run_id,compile_task_id,stale_at)',
    linkRows,
    'links',
  );
  await insertBatched(
    db,
    'knowledge_link_sources(workspace_id,link_id,source_page_id,source_version,content_hash,source_range,quote_hash,provenance_kind)',
    linkSourceRows,
    'link evidence',
  );
  await patchContributionArtifacts(db, contributionArtifacts.splice(0));
  step('creating the entity graph evidence index');
  await sql`CREATE INDEX idx_entity_graph_source ON knowledge_graph_edge_sources(workspace_id,source_page_id,graph_edge_id)`.execute(
    db,
  );
  step('done');
}
function exactTitle(text: string, title: string) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    [...title].every((c) => c.codePointAt(0)! <= 127)
      ? '(?:^|[^\\p{L}\\p{N}])' + escaped + '(?:$|[^\\p{L}\\p{N}])'
      : escaped,
    'iu',
  ).test(text);
}
