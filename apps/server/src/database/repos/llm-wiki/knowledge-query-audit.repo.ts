import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { JsonValue } from '@akasha/db/types/db';
import { KyselyDB } from '@akasha/db/types/kysely.types';

/**
 * Wall-clock phase breakdown of the answered query, in milliseconds.
 *
 * Structurally mirrors `AiKnowledgeChatTimings` in the llm-wiki service layer.
 * It is duplicated rather than imported so this db-layer repo does not depend
 * on an ee service, matching how the retrieval diagnostics counts below are
 * already carried structurally.
 *
 * Phases that did not run are omitted rather than stored as 0.
 */
export type KnowledgeQueryAuditTimings = {
  /** Query rewrite. Absent when the rewrite was skipped. */
  rewriteMs?: number;
  /** Retrieval. Absent on paths that never retrieve. */
  retrievalMs?: number;
  /**
   * Time to first token, measured from the generation request. With thinking
   * enabled the first token is a reasoning token, so this covers queue and
   * prefill. Absent when the provider does not stream.
   */
  ttftMs?: number;
  /** Answer generation. Summed across attempts on fallback. */
  generationMs?: number;
  /** Whole chat pipeline, excluding controller-side post-processing. */
  totalMs: number;
};

export type KnowledgeQueryAuditMetadata = {
  origin?:
    | 'knowledge_query'
    | 'ai_qa'
    | 'mcp_query_knowledge'
    | 'iself_knowledge_query';
  type?: 'user' | 'robot';
  personalApiKeyId?: string;
  publicApiKeyId?: string;
  answerMode?: 'knowledge' | 'no_match' | 'general';
  citationCount?: number;
  retrievedSourceCount?: number;
  /** Phase timings. Absent for callers that do not report them. */
  timings?: KnowledgeQueryAuditTimings;
  spaceIds: string[];
  requestedSpaceIds?: string[];
  effectiveSpaceIds?: string[];
  publicScopeValidated?: boolean;
  queryEmbeddingAvailable: boolean;
  candidateSourceCount: number;
  policyCandidateSourceCount: number;
  fallbackCandidateSourceCount: number;
  finalAuthorizedSourceCount: number;
  accessPolicyFallbackUsed: boolean;
  candidateChunkCount: number;
  rankedCandidateCount: number;
  authorizedChunkCount: number;
  filteredChunkCount: number;
  finalChunkIds?: string[];
  finalSourcePageIds?: string[];
  trustedCitationIds?: string[];
  rankReasonsByChunk?: Record<string, string[]>;
  evidenceRefs?: Array<{
    sourcePageId: string;
    sourceRange: { startOffset: number; endOffset: number };
    quoteHash: string;
  }>;
};

export type KnowledgeRetrievalAuditSummary = {
  sampleCount: number;
  zeroHitRate: number;
  embeddingFallbackRate: number;
  accessPolicyFallbackRate: number;
  averageAuthorizedCandidateCount: number;
  averageFilteredCandidateCount: number;
};

@Injectable()
export class KnowledgeQueryAuditRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async recordQuery(input: {
    workspaceId: string;
    userId: string | null;
    queryHash: string;
    retrievalMode: string;
    authorizedCapsuleCount: number;
    metadata: KnowledgeQueryAuditMetadata;
  }): Promise<void> {
    await this.db
      .insertInto('knowledgeQueryAudit')
      .values({
        workspaceId: input.workspaceId,
        userId: input.userId,
        queryHash: input.queryHash,
        retrievalMode: input.retrievalMode,
        authorizedCapsuleCount: input.authorizedCapsuleCount,
        metadata: input.metadata as JsonValue,
      })
      .execute();
  }

  async summarizeWorkspace(input: {
    workspaceId: string;
    limit?: number;
  }): Promise<KnowledgeRetrievalAuditSummary> {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const rows = await this.db
      .selectFrom('knowledgeQueryAudit')
      .select(['authorizedCapsuleCount', 'metadata'])
      .where('workspaceId', '=', input.workspaceId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .execute();

    if (rows.length === 0) {
      return emptySummary();
    }

    const metadataRows = rows.map((row) => toAuditMetadata(row.metadata));
    const sampleCount = rows.length;

    return {
      sampleCount,
      zeroHitRate: rate(
        rows.filter((row) => row.authorizedCapsuleCount === 0).length,
        sampleCount,
      ),
      embeddingFallbackRate: rate(
        metadataRows.filter(
          (metadata) => metadata.queryEmbeddingAvailable === false,
        ).length,
        sampleCount,
      ),
      accessPolicyFallbackRate: rate(
        metadataRows.filter(
          (metadata) => metadata.accessPolicyFallbackUsed === true,
        ).length,
        sampleCount,
      ),
      averageAuthorizedCandidateCount: average(
        metadataRows.map((metadata) => metadata.authorizedChunkCount),
      ),
      averageFilteredCandidateCount: average(
        metadataRows.map((metadata) => metadata.filteredChunkCount),
      ),
    };
  }
}

function emptySummary(): KnowledgeRetrievalAuditSummary {
  return {
    sampleCount: 0,
    zeroHitRate: 0,
    embeddingFallbackRate: 0,
    accessPolicyFallbackRate: 0,
    averageAuthorizedCandidateCount: 0,
    averageFilteredCandidateCount: 0,
  };
}

function toAuditMetadata(value: unknown): Partial<KnowledgeQueryAuditMetadata> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Partial<KnowledgeQueryAuditMetadata>)
    : {};
}

function rate(count: number, total: number): number {
  if (total === 0) return 0;
  return count / total;
}

function average(values: Array<number | undefined>): number {
  if (values.length === 0) return 0;
  return (
    values.reduce(
      (sum, value) => sum + (typeof value === 'number' ? value : 0),
      0,
    ) / values.length
  );
}
