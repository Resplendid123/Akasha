import { Injectable } from '@nestjs/common';
import {
  KnowledgeSpaceExecutionRepo,
  SpaceExecutionLease,
} from '@akasha/db/repos/llm-wiki/knowledge-space-execution.repo';

export type KnowledgeSpaceFinalizationResult = {
  outcome: 'completed' | 'superseded';
};

/** Relations publish with their source. Finalization only verifies the lease. */
@Injectable()
export class KnowledgeSpaceFinalizerService {
  constructor(private readonly executionRepo: KnowledgeSpaceExecutionRepo) {}

  async finalizeLeased(
    lease: SpaceExecutionLease,
    input: {
      workspaceId: string;
      spaceId: string;
      abortSignal?: AbortSignal;
    },
  ): Promise<KnowledgeSpaceFinalizationResult> {
    input.abortSignal?.throwIfAborted();
    const active = await this.executionRepo.isLeaseActive(lease);
    input.abortSignal?.throwIfAborted();
    return { outcome: active ? 'completed' : 'superseded' };
  }
}
