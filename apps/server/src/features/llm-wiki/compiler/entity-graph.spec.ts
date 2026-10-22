import { buildEntityGraph, entityEdgeIdentity } from './entity-graph';
import {
  SemanticAnalysis,
  semanticAnalysisSchema,
} from './semantic-compiler.schema';
import { KnowledgeSourceSnapshot } from '../types/source-snapshot.types';
import { CompileDiagnostic } from '../types/compiler-artifact.types';

const source: KnowledgeSourceSnapshot = {
  workspaceId: 'w',
  spaceId: 's',
  sourcePageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sourceVersion: '1',
  contentHash: 'h',
  text: 'Alpha depends on Beta. Alpha uses Beta.',
  title: 'Source',
  references: [],
};
const from = {
  canonicalKey: 'alpha',
  name: 'Alpha',
  type: 'service',
  alias: ['Alpha API'],
};
const to = {
  canonicalKey: 'beta',
  name: 'Beta',
  type: 'technique',
  alias: [],
};
const analysis: SemanticAnalysis = {
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
      from,
      to,
      relation: 'depends_on',
      evidenceQuote: 'Alpha depends on Beta.',
    },
  ],
};
function compile(a: SemanticAnalysis = analysis, s = source) {
  return buildEntityGraph({
    input: s,
    source: s,
    analysis: a,
    warnings: [],
  });
}
describe('relation-derived nodes and edges', () => {
  it('constructs both endpoints solely from relations with no entities or concepts', () => {
    const { graphNodes, graphEdges } = compile();
    expect(graphNodes).toHaveLength(2);
    expect(graphEdges).toHaveLength(1);
    expect(graphNodes[0]).toMatchObject({
      name: 'Alpha',
      type: 'service',
      alias: ['Alpha API'],
    });
    expect(graphEdges[0].from.id).toBe(graphNodes[0].id);
    expect(graphEdges[0].to.id).toBe(graphNodes[1].id);
    expect(graphEdges[0].inputSourceRefs[0].sourceRange).toEqual({
      startOffset: 0,
      endOffset: 22,
    });
    expect(
      compile({
        ...analysis,
        relations: [],
        entities: [
          {
            canonicalKey: 'orphan',
            name: 'Unused',
            description: 'Unused',
            evidenceQuotes: [],
          },
        ],
      }).graphNodes,
    ).toEqual([]);
  });
  it('unions aliases across repeated endpoints and preserves independently grounded edges', () => {
    const second = {
      ...analysis.relations[0],
      from: { ...from, name: 'Alpha API', alias: ['A', 'Alpha'] },
      evidenceQuote: 'Alpha uses Beta.',
    };
    const result = compile({
      ...analysis,
      relations: [analysis.relations[0], analysis.relations[0], second],
    });
    expect(result.graphNodes).toHaveLength(2);
    expect(result.graphNodes[0].alias).toEqual(['A', 'Alpha API']);
    expect(result.graphEdges).toHaveLength(2);
    expect(result.graphEdges.every((e) => e.from.alias.includes('A'))).toBe(
      true,
    );
    expect(entityEdgeIdentity(result.graphEdges[0])).not.toBe(
      entityEdgeIdentity(result.graphEdges[1]),
    );
  });
  it('settles contradictory types deterministically and reports the conflict', () => {
    const conflicting = {
      ...analysis,
      relations: [
        analysis.relations[0],
        { ...analysis.relations[0], from: { ...from, type: 'organization' } },
      ],
    };
    const warnings: CompileDiagnostic[] = [];
    const result = buildEntityGraph({
      input: source,
      source,
      analysis: conflicting,
      warnings,
    });
    expect(result.graphNodes[0].type).toBe('organization');
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'conflicting_graph_node_type',
        sourcePageId: source.sourcePageId,
      }),
    ]);
    const reversed = buildEntityGraph({
      input: source,
      source,
      analysis: { ...conflicting, relations: [...conflicting.relations].reverse() },
      warnings: [],
    });
    expect(reversed.graphNodes[0].type).toBe('organization');
  });
  it('keeps node metadata stable when the model reorders its relations', () => {
    const second = {
      ...analysis.relations[0],
      from: { ...from, name: 'Zulu', alias: ['Z'] },
      evidenceQuote: 'Alpha uses Beta.',
    };
    const forward = compile({
      ...analysis,
      relations: [analysis.relations[0], second],
    }).graphNodes[0];
    const backward = compile({
      ...analysis,
      relations: [second, analysis.relations[0]],
    }).graphNodes[0];
    expect(forward.name).toBe('Alpha');
    expect(forward).toEqual(backward);
  });
  it('shares one space-scoped identity across sources while keeping metadata rows apart', () => {
    const first = compile().graphNodes[0];
    expect(first.canonicalKey).toBe('alpha');
    expect(
      compile(analysis, { ...source, sourceVersion: '2' }).graphNodes[0].id,
    ).toBe(first.id);
    const other = compile(analysis, {
      ...source,
      sourcePageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    }).graphNodes[0];
    expect(other.canonicalKey).toBe(first.canonicalKey);
    expect(other.id).not.toBe(first.id);
    expect(
      compile(analysis, { ...source, spaceId: 's2' }).graphNodes[0]
        .canonicalKey,
    ).toBe(first.canonicalKey);
    expect(
      compile({
        ...analysis,
        relations: [
          { ...analysis.relations[0], from: { ...from, canonicalKey: 'ALPHA' } },
        ],
      }).graphNodes[0].id,
    ).toBe(first.id);
  });
  it('requires type and alias in every JSON triple endpoint', () => {
    expect(semanticAnalysisSchema.safeParse(analysis).success).toBe(true);
    expect(
      semanticAnalysisSchema.safeParse({
        ...analysis,
        relations: [
          {
            ...analysis.relations[0],
            from: { canonicalKey: 'alpha' },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      semanticAnalysisSchema.safeParse({
        ...analysis,
        relations: [
          { ...analysis.relations[0], from: { ...from, alias: undefined } },
        ],
      }).success,
    ).toBe(false);
  });
});
