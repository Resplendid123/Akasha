import { KnowledgeRetrievalRankerService } from './knowledge-retrieval-ranker.service';

describe('KnowledgeRetrievalRankerService', () => {
  it('ranks compiled chunks by semantic score and BM25 rerank, then collapses to pages', () => {
    const ranker = new KnowledgeRetrievalRankerService();

    expect(
      ranker.rankPageIds({
        query: 'AkashaQwenSmokeTest 是什么？',
        queryEmbedding: [1, 0],
        chunks: [
          chunk(
            'chunk-1',
            'kp-semantic-only',
            [1, 0],
            'Unrelated compiled chunk',
          ),
          chunk(
            'chunk-2',
            'kp-exact',
            [0.6, 0.8],
            'AkashaQwenSmokeTest retrieval behavior',
          ),
          chunk('chunk-3', 'kp-exact', [0.7, 0.7], 'AkashaQwenSmokeTest setup'),
        ],
        limit: 2,
      }),
    ).toEqual(['kp-exact', 'kp-semantic-only']);
  });

  it('drops chunks with malformed or dimension-mismatched embeddings', () => {
    const ranker = new KnowledgeRetrievalRankerService();

    expect(
      ranker.rankPageIds({
        query: 'retrieval',
        queryEmbedding: [1, 0],
        chunks: [
          chunk('chunk-1', 'kp-1', [1], 'retrieval'),
          chunk('chunk-2', 'kp-2', null, 'retrieval'),
          chunk('chunk-3', 'kp-3', [1, 0], 'retrieval'),
        ],
        limit: 10,
      }),
    ).toEqual(['kp-3']);
  });

  it('uses Chinese query terms when reranking exact factual chunks', () => {
    const ranker = new KnowledgeRetrievalRankerService();

    expect(
      ranker
        .rankChunks({
          query: 'chaterm 登记批准日期',
          queryEmbedding: [1, 0],
          chunks: [
            chunk(
              'chunk-kms',
              'kp-kms',
              [1, 0],
              'Chaterm 使用 AWS KMS 信封加密保护用户数据。',
            ),
            chunk(
              'chunk-date',
              'kp-date',
              [0.4, 0.9],
              '软件名称：合合信息Chaterm企业版软件 登记批准日期：2026年06月05日',
            ),
          ],
          limit: 2,
        })
        .map((item) => item.id),
    ).toEqual(['chunk-date', 'chunk-kms']);
  });

  it('ranks hybrid candidates without requiring query embeddings', () => {
    const ranker = new KnowledgeRetrievalRankerService();

    expect(
      ranker
        .rankHybridCandidates({
          query: 'AkashaQwenSmokeTest',
          candidates: [
            {
              chunk: chunk(
                'chunk-lexical',
                'kp-lexical',
                null,
                'AkashaQwenSmokeTest retrieval behavior',
              ),
              page: page('kp-lexical'),
              sourcePageIds: ['source-1'],
              signals: ['lexical'],
              lexicalScore: 3,
            },
            {
              chunk: chunk(
                'chunk-title',
                'kp-title',
                null,
                'General compiled summary',
              ),
              page: page('kp-title', 'AkashaQwenSmokeTest'),
              sourcePageIds: ['source-2'],
              signals: ['exact-title'],
              lexicalScore: 1,
            },
          ],
          limit: 2,
        })
        .map((candidate) => ({
          id: candidate.chunk.id,
          reasons: candidate.rankReasons,
        })),
    ).toEqual([
      {
        id: 'chunk-title',
        reasons: ['exact-title'],
      },
      {
        id: 'chunk-lexical',
        reasons: ['lexical'],
      },
    ]);
  });

  it('merges semantic, lexical, and title ranks with RRF', () => {
    const ranker = new KnowledgeRetrievalRankerService();

    expect(
      ranker
        .rankHybridCandidates({
          query: 'deployment',
          queryEmbedding: [1, 0],
          candidates: [
            {
              chunk: chunk('chunk-semantic', 'kp-semantic', [1, 0], 'Other'),
              page: page('kp-semantic'),
              sourcePageIds: ['source-1'],
              signals: ['semantic'],
            },
            {
              chunk: chunk(
                'chunk-combined',
                'kp-combined',
                [0.8, 0.2],
                'deployment guide',
              ),
              page: page('kp-combined', 'deployment'),
              sourcePageIds: ['source-2'],
              signals: ['semantic', 'lexical', 'exact-title'],
              lexicalScore: 2,
            },
            {
              chunk: chunk(
                'chunk-lexical',
                'kp-lexical',
                [0.1, 0.9],
                'deployment checklist',
              ),
              page: page('kp-lexical'),
              sourcePageIds: ['source-3'],
              signals: ['lexical'],
              lexicalScore: 3,
            },
          ],
          limit: 3,
          rrfK: 60,
        })
        .map((candidate) => candidate.chunk.id),
    ).toEqual(['chunk-combined', 'chunk-lexical', 'chunk-semantic']);
  });

  it('fuses independently ranked SQL recall lists and merges duplicate signals', () => {
    const ranker = new KnowledgeRetrievalRankerService();
    const shared = {
      chunk: chunk('chunk-shared', 'kp-shared', null, 'deployment guide'),
      page: page('kp-shared', 'deployment'),
      sourcePageIds: ['source-shared'],
      signals: ['semantic' as const],
      signalScore: 0.1,
    };

    const ranked = ranker.fuseRecallLists({
      recallLists: [
        { signal: 'semantic', candidates: [shared] },
        {
          signal: 'lexical',
          candidates: [
            {
              ...shared,
              signals: ['lexical'],
              signalScore: 9,
            },
            {
              chunk: chunk('chunk-lexical', 'kp-lexical', null, 'deployment'),
              page: page('kp-lexical'),
              sourcePageIds: ['source-lexical'],
              signals: ['lexical'],
              signalScore: 8,
            },
          ],
        },
        {
          signal: 'exact-title',
          candidates: [{ ...shared, signals: ['exact-title'], signalScore: 1 }],
        },
      ],
      limit: 2,
      rrfK: 60,
    });

    expect(ranked.map((candidate) => candidate.chunk.id)).toEqual([
      'chunk-shared',
      'chunk-lexical',
    ]);
    expect(ranked[0].rankReasons).toEqual([
      'exact-title',
      'semantic',
      'lexical',
    ]);
    expect(ranked[0].signals).toEqual(['semantic', 'lexical', 'exact-title']);
  });

  it('keeps rank reasons to matching methods; the graph path is carried by origin instead', () => {
    const ranker = new KnowledgeRetrievalRankerService();

    const ranked = ranker.fuseRecallLists({
      recallLists: [
        {
          signal: 'semantic',
          candidates: [
            {
              chunk: chunk('chunk-graph', 'kp-graph', null, 'deployment guide'),
              page: page('kp-graph', 'deployment'),
              sourcePageIds: ['source-graph'],
              signals: ['semantic', 'graph'],
              signalScore: 0.1,
            },
          ],
        },
      ],
      limit: 2,
    });

    expect(ranked[0].rankReasons).toEqual(['semantic']);
  });

  it('applies weights per recall list so graph channels can be discounted independently', () => {
    const ranker = new KnowledgeRetrievalRankerService();
    const direct = {
      chunk: chunk('chunk-direct', 'kp-direct', null, 'direct result'),
      page: page('kp-direct'),
      sourcePageIds: ['source-direct'],
      signals: ['lexical' as const],
      signalScore: 1,
      lexicalScore: 1,
    };
    const graph = {
      chunk: chunk('chunk-graph', 'kp-graph', null, 'graph result'),
      page: page('kp-graph'),
      sourcePageIds: ['source-graph'],
      signals: ['lexical' as const, 'graph' as const],
      signalScore: 1,
      lexicalScore: 1,
    };

    const ranked = ranker.fuseRecallLists({
      recallLists: [
        { signal: 'lexical', candidates: [direct], weight: 0.8 },
        { signal: 'lexical', candidates: [graph], weight: 0.15 },
      ],
      limit: 2,
    });

    expect(ranked.map((candidate) => candidate.chunk.id)).toEqual([
      'chunk-direct',
      'chunk-graph',
    ]);
  });

  it('keeps a graph candidate subject to the same relevance gate as a direct hit', () => {
    const ranker = new KnowledgeRetrievalRankerService();
    const graphCandidate = {
      chunk: chunk('chunk-graph', 'kp-graph', null, 'unrelated cafeteria menu'),
      page: page('kp-graph', 'cafeteria'),
      sourcePageIds: ['source-graph'],
      signals: ['semantic' as const, 'graph' as const],
      signalScore: 0.9,
    };
    const [ranked] = ranker.fuseRecallLists({
      recallLists: [{ signal: 'semantic', candidates: [graphCandidate] }],
      limit: 1,
    });

    expect(
      ranker.isCandidateRelevant({
        candidate: ranked,
        maxCosineDistance: 0.2,
      }),
    ).toBe(false);
  });

  it('rejects a semantic-only candidate whose distance exceeds the default threshold', () => {
    const ranker = new KnowledgeRetrievalRankerService();
    const ranked = ranker.fuseRecallLists({
      recallLists: [
        {
          signal: 'semantic',
          candidates: [
            {
              chunk: chunk(
                'chunk-unrelated',
                'kp-unrelated',
                [0, 1],
                'Database backup retention settings',
              ),
              page: page('kp-unrelated', 'Backup operations'),
              sourcePageIds: ['source-unrelated'],
              signals: ['semantic'],
              signalScore: 0.91,
            },
          ],
        },
      ],
      limit: 10,
    });

    expect('isCandidateRelevant' in ranker).toBe(true);
    if (!('isCandidateRelevant' in ranker)) return;
    expect(
      (
        ranker as KnowledgeRetrievalRankerService & {
          isCandidateRelevant(input: unknown): boolean;
        }
      ).isCandidateRelevant({
        candidate: ranked[0],
      }),
    ).toBe(false);
  });

  it('keeps positive lexical candidates for the answer model to assess', () => {
    const ranker = new KnowledgeRetrievalRankerService();
    const ranked = ranker.fuseRecallLists({
      recallLists: [
        {
          signal: 'lexical',
          candidates: [
            {
              chunk: chunk(
                'chunk-lexical',
                'kp-lexical',
                null,
                'Database backup retention settings',
              ),
              page: page('kp-lexical', 'Backup operations'),
              sourcePageIds: ['source-lexical'],
              signals: ['lexical'],
              signalScore: 0.01,
            },
          ],
        },
      ],
      limit: 10,
    });

    expect(
      ranker.isCandidateRelevant({
        candidate: ranked[0],
      }),
    ).toBe(true);
  });

  it('uses a caller-provided semantic cosine distance threshold', () => {
    const ranker = new KnowledgeRetrievalRankerService();
    const ranked = ranker.fuseRecallLists({
      recallLists: [
        {
          signal: 'semantic',
          candidates: [
            {
              chunk: chunk(
                'chunk-unrelated',
                'kp-unrelated',
                [0, 1],
                'Database backup retention settings',
              ),
              page: page('kp-unrelated', 'Backup operations'),
              sourcePageIds: ['source-unrelated'],
              signals: ['semantic'],
              signalScore: 0.91,
            },
          ],
        },
      ],
      limit: 10,
    });

    expect(
      ranker.isCandidateRelevant({
        candidate: ranked[0],
        maxCosineDistance: 1,
      }),
    ).toBe(true);
  });

  it('does not let incidental query/text term overlap rescue a semantically distant chunk', () => {
    const ranker = new KnowledgeRetrievalRankerService();
    // The query shares the term "云桌面" with the chunk text, but the chunk is
    // semantically unrelated (distance 0.9). Overlap must not override the gate.
    const ranked = ranker.fuseRecallLists({
      recallLists: [
        {
          signal: 'semantic',
          candidates: [
            {
              chunk: chunk(
                'chunk-overlap',
                'kp-overlap',
                [0, 1],
                '云桌面支持公共账号登录并多人共享使用',
              ),
              page: page('kp-overlap', '云桌面公共账号支持'),
              sourcePageIds: ['source-overlap'],
              signals: ['semantic'],
              signalScore: 0.9,
            },
          ],
        },
      ],
      limit: 10,
    });

    expect(
      ranker.isCandidateRelevant({
        candidate: ranked[0],
        maxCosineDistance: 0.2,
      }),
    ).toBe(false);
  });
});

function page(id: string, title = `Title ${id}`) {
  return {
    id,
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
    compileScope: 'page',
    canonicalKey: id,
    title,
    slug: id,
    pageType: null,
    body: `Body ${id}`,
    summary: null,
    compiledAt: new Date('2026-06-16T00:00:00.000Z'),
    compilerVersion: 'compiler@1',
    compilerRunId: 'run-1',
    compileTaskId: 'task-1',
    staleAt: null,
    createdAt: new Date('2026-06-16T00:00:00.000Z'),
    updatedAt: new Date('2026-06-16T00:00:00.000Z'),
    generationMode: 'legacy',
  };
}

function chunk(
  id: string,
  knowledgePageId: string,
  embedding: number[] | null,
  text: string,
) {
  return {
    id,
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
    knowledgePageId,
    claimId: null,
    text,
    contentHash: `${id}-hash`,
    embedding: embedding ? JSON.stringify(embedding) : null,
    embeddingLegacy: embedding,
    embeddingProfile: embedding ? 'a'.repeat(64) : null,
    embeddingModel: embedding ? 'test-embedding' : null,
    embeddingDimensions: embedding?.length ?? null,
    searchTsv: null,
    compilerRunId: 'run-1',
    compileTaskId: 'task-1',
    staleAt: null,
    createdAt: new Date('2026-06-16T00:00:00.000Z'),
  };
}
