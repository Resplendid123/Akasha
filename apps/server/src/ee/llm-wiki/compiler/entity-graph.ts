import { createHash } from 'node:crypto';
import { SemanticAnalysis } from './semantic-compiler.schema';
import {
  CompileDiagnostic,
  CompileSpaceInput,
} from '../types/compiler-artifact.types';
import {
  CompiledEntityGraphEdge,
  CompiledGraphNode,
  KnowledgeEntityEndpoint,
} from '../types/entity-graph.types';
import { KnowledgeSourceSnapshot } from '../types/source-snapshot.types';
import { KnowledgeSourceRef } from '../types/knowledge.types';
import { stableKnowledgeUuid } from '../services/knowledge-stable-id';

export function normalizeEntityKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
}
type ExtractedNode = SemanticAnalysis['relations'][number]['from'];
export function graphNodeId(
  scope: Pick<CompileSpaceInput, 'workspaceId' | 'spaceId'>,
  ownerSourcePageId: string,
  node: Pick<KnowledgeEntityEndpoint, 'canonicalKey'>,
): string {
  return stableKnowledgeUuid(
    JSON.stringify([
      scope.workspaceId,
      scope.spaceId,
      ownerSourcePageId,
      node.canonicalKey,
    ]),
  );
}
export function buildEntityGraph(input: {
  input: Pick<CompileSpaceInput, 'workspaceId' | 'spaceId'>;
  source: KnowledgeSourceSnapshot;
  analysis: SemanticAnalysis;
  warnings: CompileDiagnostic[];
}): { graphNodes: CompiledGraphNode[]; graphEdges: CompiledEntityGraphEdge[] } {
  const scope = {
    workspaceId: input.input.workspaceId,
    spaceId: input.input.spaceId,
  };
  const candidates = new Map<
    string,
    { canonicalKey: string; names: Set<string>; types: Set<string>; alias: Set<string> }
  >();
  function endpoint(node: ExtractedNode): string {
    if (!node?.name?.trim() || !node.type?.trim() || !Array.isArray(node.alias))
      throw new Error('invalid_graph_node_metadata');
    const canonicalKey = normalizeEntityKey(node.canonicalKey);
    const id = graphNodeId(scope, input.source.sourcePageId, { canonicalKey });
    const entry =
      candidates.get(id) ??
      {
        canonicalKey,
        names: new Set<string>(),
        types: new Set<string>(),
        alias: new Set<string>(),
      };
    entry.names.add(node.name.trim());
    entry.types.add(node.type.trim());
    for (const alias of node.alias) entry.alias.add(alias.trim());
    candidates.set(id, entry);
    return id;
  }
  function resolve(id: string): CompiledGraphNode {
    const entry = candidates.get(id)!;
    const names = [...entry.names].sort();
    const types = [...entry.types].sort();
    const name = names[0];
    if (types.length > 1)
      input.warnings.push({
        code: 'conflicting_graph_node_type',
        message: `Relations typed "${entry.canonicalKey}" as ${types.join(', ')}; kept "${types[0]}".`,
        sourcePageId: input.source.sourcePageId,
      });
    const alias = [
      ...new Map(
        [...entry.alias, ...names.slice(1)]
          .filter((a) => a)
          .map((a) => [normalizeEntityKey(a), a]),
      ).values(),
    ]
      .filter((a) => normalizeEntityKey(a) !== normalizeEntityKey(name))
      .sort();
    return {
      ...scope,
      id,
      canonicalKey: entry.canonicalKey,
      name,
      type: types[0],
      alias,
      ownerSourcePageId: input.source.sourcePageId,
    };
  }
  const drafts: Array<{ fromId: string; toId: string; relation: string; ref: KnowledgeSourceRef }> =
    [];
  for (const relation of input.analysis.relations) {
    const fromId = endpoint(relation.from),
      toId = endpoint(relation.to);
    const ref: KnowledgeSourceRef = {
      ...scope,
      sourcePageId: input.source.sourcePageId,
      sourceVersion: input.source.sourceVersion,
      contentHash: input.source.contentHash,
    };
    if (relation.evidenceQuote) {
      const offset = input.source.text.indexOf(relation.evidenceQuote);
      if (offset >= 0) {
        ref.sourceRange = {
          startOffset: offset,
          endOffset: offset + relation.evidenceQuote.length,
        };
        ref.quoteHash = 'sha256:' + hash(relation.evidenceQuote);
      } else
        input.warnings.push({
          code: 'evidence_quote_not_found',
          message: 'Relation quote is absent; retain source-level lineage.',
          sourcePageId: input.source.sourcePageId,
        });
    }
    drafts.push({ fromId, toId, relation: relation.relation, ref });
  }
  const nodes = new Map(
    [...candidates.keys()].map((id) => [id, resolve(id)] as const),
  );
  const edges: CompiledEntityGraphEdge[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    const edge = {
      ...scope,
      from: nodes.get(draft.fromId)!,
      to: nodes.get(draft.toId)!,
      relation: draft.relation,
      inputSourceRefs: [draft.ref],
    };
    const id = entityEdgeIdentity(edge);
    if (!seen.has(id)) {
      seen.add(id);
      edges.push(edge);
    }
  }
  return { graphNodes: [...nodes.values()], graphEdges: edges };
}
export function entityEdgeIdentity(edge: CompiledEntityGraphEdge): string {
  return JSON.stringify([
    edge.workspaceId,
    edge.spaceId,
    edge.from.id,
    edge.to.id,
    edge.from.canonicalKey,
    edge.relation,
    edge.to.canonicalKey,
    edge.inputSourceRefs
      .map((ref) => [
        ref.workspaceId,
        ref.spaceId,
        ref.sourcePageId,
        ref.sourceVersion,
        ref.contentHash,
        ref.sourceRange?.startOffset ?? null,
        ref.sourceRange?.endOffset ?? null,
        ref.quoteHash ?? null,
      ])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  ]);
}
function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
