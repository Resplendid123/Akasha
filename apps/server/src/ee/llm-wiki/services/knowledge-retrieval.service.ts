import { Injectable } from '@nestjs/common';
import { GroupUserRepo } from '@akasha/db/repos/group/group-user.repo';
import {
  KnowledgeCapsuleRepo,
  KnowledgeChunkCandidate,
  KnowledgeGraphEdgeType,
  KnowledgeGraphTraversalEdge,
  KnowledgeGraphTraversalSeed,
  KnowledgeRetrievalSignal,
} from '@akasha/db/repos/llm-wiki/knowledge-capsule.repo';
import { KnowledgeChunk, KnowledgePage } from '@akasha/db/types/entity.types';
import type { KnowledgeParentSection } from '@akasha/db/types/entity.types';
import { UserRepo } from '@akasha/db/repos/user/user.repo';
import { SpaceAuthorizationService } from '../../../core/space/services/space-authorization.service';
import { ConfiguredKnowledgeEmbeddingProvider } from './knowledge-embedding-provider.service';
import {
  DEFAULT_MAX_RELEVANT_COSINE_DISTANCE,
  KnowledgeRetrievalRankReason,
  KnowledgeRetrievalRankerService,
} from './knowledge-retrieval-ranker.service';
import { KnowledgeSourceAuthorizationService } from './knowledge-source-authorization.service';
import { KnowledgeAuthorizationCache } from './knowledge-source-authorization.cache';
import {
  AiChatDebugTiming,
  measureAiChatPhase,
} from '../../../common/observability/ai-chat-debug-timing';

export const KNOWLEDGE_COMPLETENESS_NOTICE =
  'Some knowledge may be unavailable because access is permission-scoped.';

/** Whether a chunk entered the result via direct recall or graph expansion. */
export type KnowledgeRetrievalOrigin = 'direct' | 'graph';

export type KnowledgeRetrievalCandidate = {
  pageId: string;
  chunkId: string;
  score: number;
  scoreType: 'semantic_distance' | 'lexical' | 'exact_title';
  reasons: KnowledgeRetrievalRankReason[];
  stage: 'direct' | 'graph';
  authorizationMode: 'policy' | 'fallback';
};

export type KnowledgeRetrievalDrop = {
  pageId: string;
  chunkId: string;
  reason: 'below_threshold' | 'filtered' | 'unauthorized' | 'rank_limit';
};

export type KnowledgeRetrievalObservation = {
  attempted: boolean;
  candidates: KnowledgeRetrievalCandidate[];
  dropped: KnowledgeRetrievalDrop[];
  topK: number;
  threshold: number;
};

export type KnowledgeRetrievalResult = {
  mode: 'high_completeness' | 'high_completeness_fallback';
  chunks: Array<{
    chunk: KnowledgeChunk;
    page: KnowledgePage;
    sourcePageIds: string[];
    rankReasons: KnowledgeRetrievalRankReason[];
    // Recorded before direct/graph merge so downstream consumers never have to
    // infer the source from rankReasons text (§7.1).
    origin: KnowledgeRetrievalOrigin;
    parentSection?: KnowledgeParentSection;
  }>;
  capsules: KnowledgePage[];
  completenessNotice: typeof KNOWLEDGE_COMPLETENESS_NOTICE;
  scope: KnowledgeRetrievalScope;
  diagnostics: KnowledgeRetrievalDiagnostics;
  // Direct-hit chunk ids that survived final selection, in retrieval-rank
  // order. Populated before citation resolution rewrites parent bodies or the
  // context budget truncates chunks (§7.1).
  directHitChunkIds: string[];
  retrievalObservation: KnowledgeRetrievalObservation;
};

export type KnowledgeRetrievalScope = {
  requestedSpaceIds: string[];
  effectiveSpaceIds: string[];
};

export type KnowledgeRetrievalDiagnostics = {
  queryEmbeddingAvailable: boolean;
  candidateSourceCount: number;
  policyCandidateSourceCount: number;
  fallbackCandidateSourceCount: number;
  finalAuthorizedSourceCount: number;
  accessPolicyFallbackUsed: boolean;
  candidateChunkCount: number;
  denseCandidateCount: number;
  lexicalCandidateCount: number;
  titleCandidateCount: number;
  evidenceCandidateCount: number;
  memoryCandidateCount: number;
  rankedCandidateCount: number;
  authorizedChunkCount: number;
  filteredChunkCount: number;
  graph: {
    candidateCount: number;
    gatedOutCount: number;
    selectedCount: number;
    expandedSeedCount: number;
    edgeCounts: Record<KnowledgeGraphEdgeType, number>;
    pageCountsByHop: Record<number, number>;
  };
};

@Injectable()
export class KnowledgeRetrievalService {
  constructor(
    private readonly userRepo: UserRepo,
    private readonly spaceAuthorization: SpaceAuthorizationService,
    private readonly capsuleRepo: KnowledgeCapsuleRepo,
    private readonly groupUserRepo: GroupUserRepo,
    private readonly sourceAuthorization: KnowledgeSourceAuthorizationService,
    private readonly embeddingProvider: ConfiguredKnowledgeEmbeddingProvider,
    private readonly ranker: KnowledgeRetrievalRankerService,
  ) {}

  async retrieve(input: {
    workspaceId: string;
    userId: string;
    supplementalUserId?: string;
    query: string;
    spaceIds: string[];
    labelNames?: string[];
    candidateLimit?: number;
    /** Maximum semantic cosine distance accepted during recall. */
    maxCosineDistance?: number;
    abortSignal?: AbortSignal;
    authCache?: KnowledgeAuthorizationCache;
    debugTiming?: AiChatDebugTiming;
  }): Promise<KnowledgeRetrievalResult> {
    const candidateLimit = input.candidateLimit ?? 20;
    const requestedSpaceIds = unique(input.spaceIds);
    const emptyScope: KnowledgeRetrievalScope = {
      requestedSpaceIds,
      effectiveSpaceIds: [],
    };
    const emptyRetrievalObservation = (): KnowledgeRetrievalObservation => ({
      attempted: false,
      candidates: [],
      dropped: [],
      topK: candidateLimit,
      threshold:
        input.maxCosineDistance ?? DEFAULT_MAX_RELEVANT_COSINE_DISTANCE,
    });
    const authCache =
      input.authCache ??
      new KnowledgeAuthorizationCache({
        workspaceId: input.workspaceId,
        userId: input.userId,
      });
    // Fail closed before reading anything from the cache: a cache bound to a
    // different (workspace, user) must never drive this user's retrieval.
    try {
      authCache.assertScope(input.workspaceId, input.userId);
    } catch {
      return emptyResult({
        scope: emptyScope,
        retrievalObservation: emptyRetrievalObservation(),
      });
    }

    const user = await measureAiChatPhase(
      input.debugTiming,
      'retrieval.load_user',
      () =>
        authCache.getUser(() =>
          this.userRepo.findById(input.userId, input.workspaceId),
        ),
      (result) => ({ userFound: Boolean(result) }),
    );
    if (!user) {
      return emptyResult({
        scope: emptyScope,
        retrievalObservation: emptyRetrievalObservation(),
      });
    }

    const readableSpaceIds = await measureAiChatPhase(
      input.debugTiming,
      'retrieval.authorize_spaces',
      () =>
        this.spaceAuthorization.filterReadableSpaceIds({
          user,
          spaceIds: requestedSpaceIds,
        }),
      (result) => ({
        requestedSpaceCount: requestedSpaceIds.length,
        readableSpaceCount: result.length,
      }),
    );
    // Reuse this space-readability decision for the source authorization passes
    // later in this request instead of re-querying the same spaces.
    authCache.recordSpaces(requestedSpaceIds, new Set(readableSpaceIds));
    if (readableSpaceIds.length === 0) {
      return emptyResult({
        scope: {
          requestedSpaceIds,
          effectiveSpaceIds: [],
        },
        retrievalObservation: emptyRetrievalObservation(),
      });
    }

    const queryEmbedding = await measureAiChatPhase(
      input.debugTiming,
      'retrieval.embed_query',
      () =>
        input.abortSignal
          ? this.embeddingProvider.embedQuery(input.query, {
              abortSignal: input.abortSignal,
            })
          : this.embeddingProvider.embedQuery(input.query),
      (result) => ({
        embeddingAvailable: Boolean(result),
        embeddingDimensions: result?.dimensions ?? 0,
        embeddingModel: result?.model,
      }),
    );
    const queryEmbeddingAvailable = Boolean(queryEmbedding);
    const sourceCandidateLimit = candidateLimit * 10;
    const groupIds = await measureAiChatPhase(
      input.debugTiming,
      'retrieval.load_principals',
      () => this.groupUserRepo.getUserGroupIds(input.userId),
      (result) => ({ groupCount: result.length }),
    );
    const supplementalGroupIds = input.supplementalUserId
      ? await this.groupUserRepo.getUserGroupIds(input.supplementalUserId)
      : [];
    const principals = [
      { principalType: 'user' as const, principalId: input.userId },
      ...groupIds.map((groupId) => ({
        principalType: 'group' as const,
        principalId: groupId,
      })),
      ...(input.supplementalUserId
        ? [
            {
              principalType: 'user' as const,
              principalId: input.supplementalUserId,
            },
            ...supplementalGroupIds.map((groupId) => ({
              principalType: 'group' as const,
              principalId: groupId,
            })),
          ]
        : []),
    ];
    const candidateScope = {
      workspaceId: input.workspaceId,
      spaceIds: readableSpaceIds,
      principals,
      limit: sourceCandidateLimit,
      ...(input.labelNames?.length ? { labelNames: input.labelNames } : {}),
    };
    const recallChannel = (
      retrievalChannel: 'evidence' | 'memory',
      authorizationMode: 'policy' | 'final-authorization-fallback',
    ) =>
      Promise.all([
        queryEmbedding
          ? this.capsuleRepo.findDenseChunkCandidates({
              ...candidateScope,
              retrievalChannel,
              authorizationMode,
              embedding: queryEmbedding,
            })
          : Promise.resolve([]),
        this.capsuleRepo.findLexicalChunkCandidates({
          ...candidateScope,
          retrievalChannel,
          authorizationMode,
          query: input.query,
        }),
        this.capsuleRepo.findExactTitleChunkCandidates({
          ...candidateScope,
          retrievalChannel,
          authorizationMode,
          query: input.query,
        }),
      ]);
    const recall = (
      authorizationMode: 'policy' | 'final-authorization-fallback',
    ) =>
      Promise.all([
        recallChannel('evidence', authorizationMode),
        recallChannel('memory', authorizationMode),
      ]);
    const policyRecall = await measureAiChatPhase(
      input.debugTiming,
      'retrieval.policy_recall',
      () => recall('policy'),
      (result) => recallCounts(result),
    );
    let selectedRecall = policyRecall;
    let accessPolicyFallbackUsed = false;

    const rankRecallCandidates = (
      recallResult: typeof selectedRecall,
      graph?: {
        dense: KnowledgeChunkCandidate[];
        lexical: KnowledgeChunkCandidate[];
      },
    ) => fuseRecall(this.ranker, recallResult, candidateLimit, graph);
    const filterRelevantCandidates = (
      candidates: ReturnType<typeof rankRecallCandidates>,
    ) =>
      candidates.filter((candidate) =>
        this.ranker.isCandidateRelevant({
          query: input.query,
          candidate,
          maxCosineDistance: input.maxCosineDistance,
        }),
      );
    let rankingStartedAt = performance.now();
    let fusedCandidatesBeforeGate = rankRecallCandidates(selectedRecall);
    let rankedCandidates = filterRelevantCandidates(fusedCandidatesBeforeGate);
    input.debugTiming?.record(
      'retrieval.rank_candidates',
      performance.now() - rankingStartedAt,
      { rankedCandidateCount: rankedCandidates.length, pass: 'policy' },
    );
    let fallbackRecall: Awaited<ReturnType<typeof recall>> | null = null;
    if (rankedCandidates.length === 0) {
      accessPolicyFallbackUsed = true;
      fallbackRecall = await measureAiChatPhase(
        input.debugTiming,
        'retrieval.fallback_recall',
        () => recall('final-authorization-fallback'),
        (result) => recallCounts(result),
      );
      selectedRecall = fallbackRecall;
      rankingStartedAt = performance.now();
      fusedCandidatesBeforeGate = rankRecallCandidates(selectedRecall);
      rankedCandidates = filterRelevantCandidates(
        fusedCandidatesBeforeGate,
      ).map((candidate) => ({
        ...candidate,
        rankReasons: [
          ...candidate.rankReasons.filter(
            (reason) => reason !== 'sidecar-prefiltered',
          ),
          'final-authorization-fallback' as const,
        ],
      }));
      input.debugTiming?.record(
        'retrieval.rank_candidates',
        performance.now() - rankingStartedAt,
        { rankedCandidateCount: rankedCandidates.length, pass: 'fallback' },
      );
    }

    const [evidenceRecall, memoryRecall] = selectedRecall;
    const [evidenceDense, evidenceLexical, evidenceTitle] = evidenceRecall;
    const [memoryDense, memoryLexical, memoryTitle] = memoryRecall;
    const denseCandidates = [...evidenceDense, ...memoryDense];
    const lexicalCandidates = [...evidenceLexical, ...memoryLexical];
    const titleCandidates = [...evidenceTitle, ...memoryTitle];
    const candidateChunkCount = new Set(
      [...denseCandidates, ...lexicalCandidates, ...titleCandidates].map(
        (candidate) => candidate.chunk.id,
      ),
    ).size;
    const evidenceCandidateCount = uniqueCandidateCount(evidenceRecall.flat());
    const memoryCandidateCount = uniqueCandidateCount(memoryRecall.flat());
    const candidateSourcePageIds = unique(
      [...denseCandidates, ...lexicalCandidates, ...titleCandidates].flatMap(
        (candidate) => candidate.sourcePageIds,
      ),
    );
    const policyCandidateSourcePageIds = candidateSourceIds(policyRecall);
    const fallbackCandidateSourcePageIds = fallbackRecall
      ? candidateSourceIds(fallbackRecall)
      : [];
    if (rankedCandidates.length === 0) {
      return emptyResult({
        scope: {
          requestedSpaceIds,
          effectiveSpaceIds: readableSpaceIds,
        },
        diagnostics: {
          queryEmbeddingAvailable,
          candidateSourceCount: candidateSourcePageIds.length,
          policyCandidateSourceCount: policyCandidateSourcePageIds.length,
          fallbackCandidateSourceCount: fallbackCandidateSourcePageIds.length,
          accessPolicyFallbackUsed,
          candidateChunkCount,
          denseCandidateCount: uniqueCandidateCount(denseCandidates),
          lexicalCandidateCount: uniqueCandidateCount(lexicalCandidates),
          titleCandidateCount: uniqueCandidateCount(titleCandidates),
          evidenceCandidateCount,
          memoryCandidateCount,
          rankedCandidateCount: 0,
        },
        mode: 'high_completeness_fallback',
        retrievalObservation: {
          attempted: true,
          candidates: toRawRetrievalCandidates({
            policyRecall,
            fallbackRecall,
            topK: candidateLimit,
          }),
          dropped: buildRetrievalDrops({
            candidates: toRawRetrievalCandidates({
              policyRecall,
              fallbackRecall,
              topK: candidateLimit,
            }),
            selectedChunkIds: new Set(),
            relevantChunkIds: new Set(
              rankedCandidates.map((candidate) => candidate.chunk.id),
            ),
            authorizedChunkIds: new Set(),
            threshold:
              input.maxCosineDistance ?? DEFAULT_MAX_RELEVANT_COSINE_DISTANCE,
          }),
          topK: candidateLimit,
          threshold:
            input.maxCosineDistance ?? DEFAULT_MAX_RELEVANT_COSINE_DISTANCE,
        },
      });
    }

    const sourceRows = await measureAiChatPhase(
      input.debugTiming,
      'retrieval.load_chunk_sources',
      () =>
        this.capsuleRepo.findChunkSourcePageIdsByChunkIds({
          workspaceId: input.workspaceId,
          chunkIds: rankedCandidates.map((candidate) => candidate.chunk.id),
        }),
      (result) => ({ sourceRowCount: result.length }),
    );
    const sourcesByChunkId = new Map(
      sourceRows.map((row) => [row.chunkId, row.sourcePageIds]),
    );
    const allSourcePageIds = unique(
      sourceRows.flatMap((row) => row.sourcePageIds),
    );
    const readableSourcePageIds = await measureAiChatPhase(
      input.debugTiming,
      'retrieval.authorize_sources',
      () =>
        this.sourceAuthorization.filterReadableSources({
          workspaceId: input.workspaceId,
          userId: input.userId,
          supplementalUserId: input.supplementalUserId,
          sourcePageIds: allSourcePageIds,
          cache: authCache,
        }),
      (result) => ({
        candidateSourceCount: allSourcePageIds.length,
        readableSourceCount: result.length,
      }),
    );
    const readableSourceSet = new Set(readableSourcePageIds);

    const directChunkIds = new Set(
      selectedRecall.flat(2).map((candidate) => candidate.chunk.id),
    );
    const authorizeRanked = (
      candidates: typeof rankedCandidates,
      sources: Map<string, string[]>,
      readable: Set<string>,
    ): KnowledgeRetrievalResult['chunks'] => {
      const authorized: KnowledgeRetrievalResult['chunks'] = [];
      for (const candidate of candidates) {
        const sourcePageIds =
          sources.get(candidate.chunk.id) ?? candidate.sourcePageIds;
        if (
          sourcePageIds.length > 0 &&
          sourcePageIds.every((sourcePageId) => readable.has(sourcePageId))
        ) {
          authorized.push({
            chunk: candidate.chunk,
            page: candidate.page,
            sourcePageIds,
            rankReasons: candidate.rankReasons,
            origin:
              candidate.signals.includes('graph') &&
              !directChunkIds.has(candidate.chunk.id)
                ? 'graph'
                : 'direct',
            ...(candidate.parentSection
              ? { parentSection: candidate.parentSection }
              : {}),
          });
        }
      }
      return authorized;
    };
    const authorizedChunks = authorizeRanked(
      rankedCandidates,
      sourcesByChunkId,
      readableSourceSet,
    );
    const authorizedChunkIds = new Set(
      authorizedChunks.map((candidate) => candidate.chunk.id),
    );
    const relevantChunkIds = new Set(
      rankedCandidates.map((candidate) => candidate.chunk.id),
    );
    const seedWeightByPageId = new Map<string, number>();
    for (const candidate of rankedCandidates) {
      const pageId = candidate.page.id;
      seedWeightByPageId.set(
        pageId,
        Math.max(seedWeightByPageId.get(pageId) ?? 0, candidate.score),
      );
    }
    const graphExpansion = await measureAiChatPhase(
      input.debugTiming,
      'retrieval.graph_expansion',
      () =>
        this.expandGraph({
          workspaceId: input.workspaceId,
          userId: input.userId,
          supplementalUserId: input.supplementalUserId,
          readableSpaceIds,
          principals,
          seeds: unique(authorizedChunks.map((candidate) => candidate.page.id))
            .map((knowledgePageId) => ({
              knowledgePageId,
              weight: seedWeightByPageId.get(knowledgePageId) ?? 0,
            }))
            .sort(
              (left, right) =>
                right.weight - left.weight ||
                left.knowledgePageId.localeCompare(right.knowledgePageId),
            ),
          candidateLimit,
          query: input.query,
          ...(queryEmbedding ? { queryEmbedding } : {}),
          authorizationMode: accessPolicyFallbackUsed
            ? 'final-authorization-fallback'
            : 'policy',
          authCache,
          ...(input.labelNames?.length ? { labelNames: input.labelNames } : {}),
        }),
      (result) => ({
        graphSeedsExpanded: result.seedsExpanded,
        graphWindowPageCount: result.windowPageIds.length,
        graphCandidateCount: graphCandidateIds(result).size,
      }),
    );
    const graphCandidateCount = graphCandidateIds(graphExpansion).size;

    let selectedChunks = authorizedChunks.slice(0, candidateLimit);
    let gatedGraphCandidateCount = 0;
    if (graphCandidateCount > 0) {
      const fusedStartedAt = performance.now();
      let fusedCandidates = filterRelevantCandidates(
        rankRecallCandidates(selectedRecall, {
          dense: graphExpansion.dense,
          lexical: graphExpansion.lexical,
        }),
      );
      if (accessPolicyFallbackUsed) {
        fusedCandidates = fusedCandidates.map((candidate) => ({
          ...candidate,
          rankReasons: [
            ...candidate.rankReasons.filter(
              (reason) => reason !== 'sidecar-prefiltered',
            ),
            'final-authorization-fallback' as const,
          ],
        }));
      }
      for (const candidate of fusedCandidates) {
        relevantChunkIds.add(candidate.chunk.id);
      }
      gatedGraphCandidateCount =
        graphCandidateCount -
        fusedCandidates.filter((candidate) =>
          candidate.signals.includes('graph'),
        ).length;
      input.debugTiming?.record(
        'retrieval.rank_candidates',
        performance.now() - fusedStartedAt,
        {
          rankedCandidateCount: fusedCandidates.length,
          pass: 'graph-fused',
        },
      );

      const fusedSourceRows = await measureAiChatPhase(
        input.debugTiming,
        'retrieval.load_graph_chunk_sources',
        () =>
          this.capsuleRepo.findChunkSourcePageIdsByChunkIds({
            workspaceId: input.workspaceId,
            chunkIds: fusedCandidates.map((candidate) => candidate.chunk.id),
          }),
        (result) => ({ sourceRowCount: result.length }),
      );
      const fusedSourcesByChunkId = new Map(
        fusedSourceRows.map((row) => [row.chunkId, row.sourcePageIds]),
      );
      const fusedReadableSourcePageIds = await measureAiChatPhase(
        input.debugTiming,
        'retrieval.authorize_graph_sources',
        () =>
          this.sourceAuthorization.filterReadableSources({
            workspaceId: input.workspaceId,
            userId: input.userId,
            supplementalUserId: input.supplementalUserId,
            sourcePageIds: unique(
              fusedSourceRows.flatMap((row) => row.sourcePageIds),
            ),
            cache: authCache,
          }),
        (result) => ({ readableSourceCount: result.length }),
      );
      const authorizedFusedChunks = authorizeRanked(
        fusedCandidates,
        fusedSourcesByChunkId,
        new Set(fusedReadableSourcePageIds),
      );
      for (const candidate of authorizedFusedChunks) {
        authorizedChunkIds.add(candidate.chunk.id);
      }
      selectedChunks = authorizedFusedChunks.slice(0, candidateLimit);
    }
    const finalAuthorizedSourceCount = unique(
      selectedChunks.flatMap((candidate) => candidate.sourcePageIds),
    ).length;
    // Direct hits that survived blending, in their final rank order. Graph-only
    // chunks never contribute attachments (§7.1 / §1.2).
    const directHitChunkIds = selectedChunks
      .filter((candidate) => candidate.origin === 'direct')
      .map((candidate) => candidate.chunk.id);

    const observationCandidates = toRawRetrievalCandidates({
      policyRecall,
      fallbackRecall,
      topK: candidateLimit,
      graph: graphExpansion,
      graphAuthorizationMode: accessPolicyFallbackUsed ? 'fallback' : 'policy',
    });
    const retrievalObservationDrops = buildRetrievalDrops({
      candidates: observationCandidates,
      selectedChunkIds: authorizedChunkIds,
      relevantChunkIds,
      authorizedChunkIds,
      threshold:
        input.maxCosineDistance ?? DEFAULT_MAX_RELEVANT_COSINE_DISTANCE,
    });

    return {
      mode: accessPolicyFallbackUsed
        ? 'high_completeness_fallback'
        : 'high_completeness',
      chunks: selectedChunks,
      capsules: [],
      directHitChunkIds,
      retrievalObservation: {
        attempted: true,
        candidates: observationCandidates,
        dropped: retrievalObservationDrops,
        topK: candidateLimit,
        threshold:
          input.maxCosineDistance ?? DEFAULT_MAX_RELEVANT_COSINE_DISTANCE,
      },
      completenessNotice: KNOWLEDGE_COMPLETENESS_NOTICE,
      scope: {
        requestedSpaceIds,
        effectiveSpaceIds: readableSpaceIds,
      },
      diagnostics: {
        queryEmbeddingAvailable,
        candidateSourceCount: candidateSourcePageIds.length,
        policyCandidateSourceCount: policyCandidateSourcePageIds.length,
        fallbackCandidateSourceCount: fallbackCandidateSourcePageIds.length,
        finalAuthorizedSourceCount,
        accessPolicyFallbackUsed,
        candidateChunkCount,
        denseCandidateCount: uniqueCandidateCount(denseCandidates),
        lexicalCandidateCount: uniqueCandidateCount(lexicalCandidates),
        titleCandidateCount: uniqueCandidateCount(titleCandidates),
        evidenceCandidateCount,
        memoryCandidateCount,
        rankedCandidateCount: rankedCandidates.length + graphCandidateCount,
        authorizedChunkCount: selectedChunks.length,
        filteredChunkCount:
          rankedCandidates.length + graphCandidateCount - selectedChunks.length,
        graph: {
          candidateCount: graphCandidateCount,
          gatedOutCount: gatedGraphCandidateCount,
          selectedCount: selectedChunks.filter(
            (candidate) => candidate.origin === 'graph',
          ).length,
          expandedSeedCount: graphExpansion.seedsExpanded,
          edgeCounts: graphExpansion.edgesByType,
          pageCountsByHop: graphExpansion.pagesByHop,
        },
      },
    };
  }

  private async expandGraph(input: {
    workspaceId: string;
    userId: string;
    supplementalUserId?: string;
    readableSpaceIds: string[];
    principals: Array<{
      principalType: 'user' | 'group';
      principalId: string;
    }>;
    seeds: KnowledgeGraphTraversalSeed[];
    candidateLimit: number;
    query: string;
    queryEmbedding?: {
      vector: number[];
      profile: string;
      model: string;
      dimensions: number;
    };
    authorizationMode: 'policy' | 'final-authorization-fallback';
    authCache: KnowledgeAuthorizationCache;
    labelNames?: string[];
  }): Promise<GraphExpansionResult> {
    const empty: GraphExpansionResult = {
      dense: [],
      lexical: [],
      windowPageIds: [],
      seedsExpanded: 0,
      seedsSkippedByThreshold: 0,
      edgesScanned: 0,
      edgesAuthorized: 0,
      edgesByType: { semantic: 0, link: 0, 'shared-source': 0 },
      pagesByHop: {},
    };
    if (input.seeds.length === 0 || input.candidateLimit <= 1) return empty;

    const topWeight = input.seeds[0]?.weight ?? 0;
    const weightThreshold = topWeight * GRAPH_SEED_WEIGHT_RATIO;
    const eligibleSeeds = input.seeds
      .filter((seed) => seed.weight >= weightThreshold)
      .slice(0, GRAPH_SEED_LIMIT);
    if (eligibleSeeds.length === 0) return empty;
    const seedsSkippedByThreshold = input.seeds.length - eligibleSeeds.length;

    const visited = new Set(input.seeds.map((seed) => seed.knowledgePageId));
    const hopByPageId = new Map<string, number>();
    const typeWeightByPageId = new Map<string, number>();
    const edgesByType: Record<KnowledgeGraphEdgeType, number> = {
      semantic: 0,
      link: 0,
      'shared-source': 0,
    };
    let frontier = eligibleSeeds;
    let edgesScanned = 0;
    let edgesAuthorized = 0;
    const edgeLimit = Math.max(input.candidateLimit * 20, 100);

    for (let hop = 1; hop <= 2 && frontier.length > 0; hop += 1) {
      const frontierPageIds = frontier.map((seed) => seed.knowledgePageId);
      const frontierSourceIds =
        await this.capsuleRepo.findGraphFrontierSourceIds({
          workspaceId: input.workspaceId,
          spaceIds: input.readableSpaceIds,
          knowledgePageIds: frontierPageIds,
        });
      edgesScanned += frontierSourceIds.length;
      if (frontierSourceIds.length === 0) break;
      const readableSourcePageIds =
        await this.sourceAuthorization.filterReadableSources({
          workspaceId: input.workspaceId,
          userId: input.userId,
          supplementalUserId: input.supplementalUserId,
          sourcePageIds: frontierSourceIds,
          cache: input.authCache,
        });
      const edges = await this.capsuleRepo.findGraphTraversalEdges({
        workspaceId: input.workspaceId,
        spaceIds: input.readableSpaceIds,
        seeds: frontier,
        readableSourcePageIds,
        limit: edgeLimit,
      });
      if (edges.length === 0) break;
      edgesAuthorized += edges.length;

      const frontierSet = new Set(frontierPageIds);
      const nextFrontier = new Map<string, number>();
      for (const edge of edges) {
        edgesByType[edge.type] += 1;
        if (edge.sourcePageIds.length === 0) continue;
        for (const [currentPageId, neighborPageId] of edgeDirections(edge)) {
          if (!frontierSet.has(currentPageId) || visited.has(neighborPageId)) {
            continue;
          }
          nextFrontier.set(
            neighborPageId,
            Math.max(nextFrontier.get(neighborPageId) ?? 0, edge.weight),
          );
          hopByPageId.set(neighborPageId, hop);
          typeWeightByPageId.set(
            neighborPageId,
            Math.max(typeWeightByPageId.get(neighborPageId) ?? 0, edge.weight),
          );
        }
      }
      frontier = [...nextFrontier].map(([knowledgePageId, weight]) => ({
        knowledgePageId,
        weight,
      }));
      for (const seed of frontier) visited.add(seed.knowledgePageId);
    }

    const pagesByHop: Record<number, number> = {};
    for (const hop of hopByPageId.values()) {
      pagesByHop[hop] = (pagesByHop[hop] ?? 0) + 1;
    }
    const windowPageIds = [...hopByPageId.keys()]
      .sort((left, right) => {
        const hopDifference =
          (hopByPageId.get(left) ?? 3) - (hopByPageId.get(right) ?? 3);
        if (hopDifference !== 0) return hopDifference;
        const weightDifference =
          (typeWeightByPageId.get(right) ?? 0) -
          (typeWeightByPageId.get(left) ?? 0);
        return weightDifference || left.localeCompare(right);
      })
      .slice(0, graphWindowPageLimit(input.candidateLimit));
    if (windowPageIds.length === 0) {
      return {
        ...empty,
        seedsExpanded: eligibleSeeds.length,
        seedsSkippedByThreshold,
        edgesScanned,
        edgesAuthorized,
        edgesByType,
      };
    }

    const windowScope = {
      workspaceId: input.workspaceId,
      spaceIds: input.readableSpaceIds,
      principals: input.principals,
      knowledgePageIds: windowPageIds,
      authorizationMode: input.authorizationMode,
      limit: Math.max(input.candidateLimit * 2, input.candidateLimit),
      ...(input.labelNames?.length ? { labelNames: input.labelNames } : {}),
    };
    const [denseWindow, lexicalWindow] = await Promise.all([
      input.queryEmbedding
        ? this.capsuleRepo.findDenseChunkCandidates({
            ...windowScope,
            embedding: input.queryEmbedding,
          })
        : Promise.resolve([]),
      this.capsuleRepo.findLexicalChunkCandidates({
        ...windowScope,
        query: input.query,
      }),
    ]);

    const withGraphSignal = (candidate: KnowledgeChunkCandidate) => ({
      ...candidate,
      signals: unique([
        ...candidate.signals,
        'graph',
      ]) as KnowledgeRetrievalSignal[],
    });

    return {
      dense: denseWindow.map(withGraphSignal),
      lexical: lexicalWindow.map(withGraphSignal),
      windowPageIds,
      seedsExpanded: eligibleSeeds.length,
      seedsSkippedByThreshold,
      edgesScanned,
      edgesAuthorized,
      edgesByType,
      pagesByHop,
    };
  }
}

function graphCandidateIds(graph: {
  dense: KnowledgeChunkCandidate[];
  lexical: KnowledgeChunkCandidate[];
}): Set<string> {
  return new Set(
    [...graph.dense, ...graph.lexical].map((candidate) => candidate.chunk.id),
  );
}

const GRAPH_SEED_LIMIT = 8;
const GRAPH_SEED_WEIGHT_RATIO = 0.1;
function graphWindowPageLimit(candidateLimit: number): number {
  return Math.max(candidateLimit * 4, 32);
}

type GraphExpansionResult = {
  dense: KnowledgeChunkCandidate[];
  lexical: KnowledgeChunkCandidate[];
  windowPageIds: string[];
  seedsExpanded: number;
  seedsSkippedByThreshold: number;
  edgesScanned: number;
  edgesAuthorized: number;
  edgesByType: Record<KnowledgeGraphEdgeType, number>;
  pagesByHop: Record<number, number>;
};

function emptyResult(input: {
  scope: KnowledgeRetrievalScope;
  diagnostics?: Partial<KnowledgeRetrievalDiagnostics>;
  mode?: KnowledgeRetrievalResult['mode'];
  retrievalObservation?: KnowledgeRetrievalObservation;
}): KnowledgeRetrievalResult {
  return {
    mode: input.mode ?? 'high_completeness',
    chunks: [],
    capsules: [],
    directHitChunkIds: [],
    retrievalObservation: input.retrievalObservation ?? {
      attempted: false,
      candidates: [],
      dropped: [],
      topK: 20,
      threshold: DEFAULT_MAX_RELEVANT_COSINE_DISTANCE,
    },
    completenessNotice: KNOWLEDGE_COMPLETENESS_NOTICE,
    scope: input.scope,
    diagnostics: {
      queryEmbeddingAvailable: false,
      candidateSourceCount: 0,
      policyCandidateSourceCount: 0,
      fallbackCandidateSourceCount: 0,
      finalAuthorizedSourceCount: 0,
      accessPolicyFallbackUsed: false,
      candidateChunkCount: 0,
      denseCandidateCount: 0,
      lexicalCandidateCount: 0,
      titleCandidateCount: 0,
      evidenceCandidateCount: 0,
      memoryCandidateCount: 0,
      rankedCandidateCount: 0,
      authorizedChunkCount: 0,
      filteredChunkCount: 0,
      graph: {
        candidateCount: 0,
        gatedOutCount: 0,
        selectedCount: 0,
        expandedSeedCount: 0,
        edgeCounts: { semantic: 0, link: 0, 'shared-source': 0 },
        pageCountsByHop: {},
      },
      ...input.diagnostics,
    },
  };
}

function toRawRetrievalCandidates(input: {
  policyRecall: RecallShape;
  fallbackRecall?: RecallShape | null;
  topK: number;
  graph?: {
    dense: KnowledgeChunkCandidate[];
    lexical: KnowledgeChunkCandidate[];
  };
  graphAuthorizationMode?: 'policy' | 'fallback';
}): KnowledgeRetrievalCandidate[] {
  const recallLists = (
    recall: RecallShape,
    authorizationMode: 'policy' | 'fallback',
  ): KnowledgeRetrievalCandidate[] => {
    const directLists: Array<{
      signal: 'semantic' | 'lexical' | 'exact-title';
      candidates: KnowledgeChunkCandidate[];
    }> = [
      { signal: 'semantic', candidates: recall[0][0] },
      { signal: 'lexical', candidates: recall[0][1] },
      { signal: 'exact-title', candidates: recall[0][2] },
      { signal: 'semantic', candidates: recall[1][0] },
      { signal: 'lexical', candidates: recall[1][1] },
      { signal: 'exact-title', candidates: recall[1][2] },
    ];
    return directLists.flatMap(({ signal, candidates: list }) =>
      list.slice(0, input.topK).map((candidate) => ({
        pageId: candidate.page.id,
        chunkId: candidate.chunk.id,
        score: rawCandidateScore(candidate, signal),
        scoreType: rawCandidateScoreType(signal),
        reasons: rankReasonsForRawCandidate(candidate, signal),
        stage: 'direct' as const,
        authorizationMode,
      })),
    );
  };
  const candidates = [
    ...recallLists(input.policyRecall, 'policy'),
    ...(input.fallbackRecall
      ? recallLists(input.fallbackRecall, 'fallback')
      : []),
  ];
  if (!input.graph) return candidates;
  const graphLists: Array<{
    signal: 'semantic' | 'lexical' | 'exact-title';
    candidates: KnowledgeChunkCandidate[];
  }> = [
    { signal: 'semantic', candidates: input.graph.dense },
    { signal: 'lexical', candidates: input.graph.lexical },
  ];
  return [
    ...candidates,
    ...graphLists.flatMap(({ signal, candidates: list }) =>
      list.slice(0, input.topK).map((candidate) => ({
        pageId: candidate.page.id,
        chunkId: candidate.chunk.id,
        score: rawCandidateScore(candidate, signal),
        scoreType: rawCandidateScoreType(signal),
        reasons: rankReasonsForRawCandidate(candidate, signal),
        stage: 'graph' as const,
        authorizationMode: input.graphAuthorizationMode ?? 'policy',
      })),
    ),
  ];
}

type RecallShape = [
  [
    KnowledgeChunkCandidate[],
    KnowledgeChunkCandidate[],
    KnowledgeChunkCandidate[],
  ],
  [
    KnowledgeChunkCandidate[],
    KnowledgeChunkCandidate[],
    KnowledgeChunkCandidate[],
  ],
];

function rawCandidateScore(
  candidate: KnowledgeChunkCandidate,
  signal: 'semantic' | 'lexical' | 'exact-title',
): number {
  const score =
    signal === 'lexical'
      ? (candidate.lexicalScore ?? candidate.signalScore)
      : candidate.signalScore;
  return typeof score === 'number' && Number.isFinite(score) ? score : 0;
}

function rawCandidateScoreType(
  signal: 'semantic' | 'lexical' | 'exact-title',
): KnowledgeRetrievalCandidate['scoreType'] {
  return signal === 'semantic'
    ? 'semantic_distance'
    : signal === 'lexical'
      ? 'lexical'
      : 'exact_title';
}

function rankReasonsForRawCandidate(
  candidate: KnowledgeChunkCandidate,
  signal: 'semantic' | 'lexical' | 'exact-title',
): KnowledgeRetrievalRankReason[] {
  const reasons = new Set<KnowledgeRetrievalRankReason>([signal]);
  if (candidate.signals.includes('graph')) reasons.add('graph-neighbor');
  return [...reasons];
}

function buildRetrievalDrops(input: {
  candidates: KnowledgeRetrievalCandidate[];
  selectedChunkIds: Set<string>;
  relevantChunkIds: Set<string>;
  authorizedChunkIds: Set<string>;
  threshold: number;
}): KnowledgeRetrievalDrop[] {
  const drops = new Map<string, KnowledgeRetrievalDrop>();
  for (const candidate of input.candidates) {
    if (input.selectedChunkIds.has(candidate.chunkId)) continue;
    const reason: KnowledgeRetrievalDrop['reason'] =
      candidate.scoreType === 'semantic_distance' &&
      candidate.score > input.threshold
        ? 'below_threshold'
        : !input.relevantChunkIds.has(candidate.chunkId)
          ? 'filtered'
          : !input.authorizedChunkIds.has(candidate.chunkId)
            ? 'unauthorized'
            : 'rank_limit';
    const key = `${candidate.chunkId}:${candidate.pageId}:${reason}`;
    drops.set(key, {
      pageId: candidate.pageId,
      chunkId: candidate.chunkId,
      reason,
    });
  }
  return [...drops.values()];
}

function fuseRecall(
  ranker: KnowledgeRetrievalRankerService,
  recall: [
    [
      KnowledgeChunkCandidate[],
      KnowledgeChunkCandidate[],
      KnowledgeChunkCandidate[],
    ],
    [
      KnowledgeChunkCandidate[],
      KnowledgeChunkCandidate[],
      KnowledgeChunkCandidate[],
    ],
  ],
  limit: number,
  graph: {
    dense: KnowledgeChunkCandidate[];
    lexical: KnowledgeChunkCandidate[];
  } = {
    dense: [],
    lexical: [],
  },
) {
  const [evidenceRecall, memoryRecall] = recall;
  const [evidenceDense, evidenceLexical, evidenceTitle] = evidenceRecall;
  const [memoryDense, memoryLexical, memoryTitle] = memoryRecall;
  return ranker.fuseRecallLists({
    recallLists: [
      { signal: 'semantic', candidates: evidenceDense },
      { signal: 'lexical', candidates: evidenceLexical },
      { signal: 'exact-title', candidates: evidenceTitle },
      { signal: 'semantic', candidates: memoryDense },
      { signal: 'lexical', candidates: memoryLexical },
      { signal: 'exact-title', candidates: memoryTitle },
      { signal: 'semantic', candidates: graph.dense },
      { signal: 'lexical', candidates: graph.lexical },
    ],
    limit,
  });
}

function candidateSourceIds(
  recall: [
    [
      KnowledgeChunkCandidate[],
      KnowledgeChunkCandidate[],
      KnowledgeChunkCandidate[],
    ],
    [
      KnowledgeChunkCandidate[],
      KnowledgeChunkCandidate[],
      KnowledgeChunkCandidate[],
    ],
  ],
): string[] {
  return unique(recall.flat(2).flatMap((candidate) => candidate.sourcePageIds));
}

function recallCounts(
  recall: [
    [
      KnowledgeChunkCandidate[],
      KnowledgeChunkCandidate[],
      KnowledgeChunkCandidate[],
    ],
    [
      KnowledgeChunkCandidate[],
      KnowledgeChunkCandidate[],
      KnowledgeChunkCandidate[],
    ],
  ],
): Record<string, number> {
  const [evidenceRecall, memoryRecall] = recall;
  const [evidenceDense, evidenceLexical, evidenceTitle] = evidenceRecall;
  const [memoryDense, memoryLexical, memoryTitle] = memoryRecall;
  return {
    denseCandidateCount: uniqueCandidateCount([
      ...evidenceDense,
      ...memoryDense,
    ]),
    lexicalCandidateCount: uniqueCandidateCount([
      ...evidenceLexical,
      ...memoryLexical,
    ]),
    titleCandidateCount: uniqueCandidateCount([
      ...evidenceTitle,
      ...memoryTitle,
    ]),
    totalCandidateCount: uniqueCandidateCount(recall.flat(2)),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueCandidateCount(
  candidates: Array<{ chunk: { id: string } }>,
): number {
  return new Set(candidates.map((candidate) => candidate.chunk.id)).size;
}

function edgeDirections(
  edge: KnowledgeGraphTraversalEdge,
): Array<[string, string]> {
  return [
    [edge.fromKnowledgePageId, edge.toKnowledgePageId],
    [edge.toKnowledgePageId, edge.fromKnowledgePageId],
  ];
}

function allSourcesReadable(
  sourcePageIds: string[],
  readableSourcePageIds: Set<string>,
): boolean {
  return (
    sourcePageIds.length > 0 &&
    sourcePageIds.every((sourcePageId) =>
      readableSourcePageIds.has(sourcePageId),
    )
  );
}
