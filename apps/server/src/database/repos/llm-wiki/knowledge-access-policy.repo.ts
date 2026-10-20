import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@akasha/db/types/kysely.types';
import { dbOrTx } from '@akasha/db/utils';
import {
  InsertableKnowledgeSourceAccessPrincipal,
  InsertableKnowledgeSourceAccessRequirement,
  InsertableKnowledgeSourceAccessPolicy,
  KnowledgeSourceAccessPolicy,
} from '@akasha/db/types/entity.types';

type UpsertPolicyInput = Pick<
  InsertableKnowledgeSourceAccessPolicy,
  | 'workspaceId'
  | 'sourcePageId'
  | 'sourceSpaceId'
  | 'policyHash'
  | 'restrictedAncestorCount'
>;

type ReplacePolicySnapshotInput = UpsertPolicyInput & {
  requirements: Array<{
    requirementId: string;
    restrictedPageId: string;
    depth: number;
    principals: Array<{
      principalType: string;
      principalId: string;
      role: string;
    }>;
  }>;
};

export type KnowledgeAccessPrincipalInput = {
  principalType: 'user' | 'group';
  principalId: string;
};

export type KnowledgeSidecarEligibilityStatus =
  | 'eligible'
  | 'missing_policy'
  | 'stale_policy'
  | 'denied_by_restricted_ancestor'
  | 'empty_restricted_ancestor';

export type KnowledgeSidecarSourceEligibility = {
  sourcePageId: string;
  sourceSpaceId: string | null;
  status: KnowledgeSidecarEligibilityStatus;
  policyHash?: string | null;
  staleAt?: Date | null;
  updatedAt?: Date | null;
};

@Injectable()
export class KnowledgeAccessPolicyRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async upsertPolicy(
    input: UpsertPolicyInput,
    trx?: KyselyTransaction,
  ): Promise<KnowledgeSourceAccessPolicy> {
    return dbOrTx(this.db, trx)
      .insertInto('knowledgeSourceAccessPolicy')
      .values({ ...input, staleAt: null })
      .onConflict((oc) =>
        oc.columns(['workspaceId', 'sourcePageId']).doUpdateSet({
          sourceSpaceId: input.sourceSpaceId,
          policyHash: input.policyHash,
          restrictedAncestorCount: input.restrictedAncestorCount,
          staleAt: null,
          updatedAt: new Date(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findPoliciesForSources(
    input: { workspaceId: string; sourcePageIds: string[] },
    trx?: KyselyTransaction,
  ): Promise<KnowledgeSourceAccessPolicy[]> {
    if (input.sourcePageIds.length === 0) return [];

    return dbOrTx(this.db, trx)
      .selectFrom('knowledgeSourceAccessPolicy')
      .selectAll()
      .where('workspaceId', '=', input.workspaceId)
      .where('sourcePageId', 'in', input.sourcePageIds)
      .execute();
  }

  async replacePolicySnapshot(
    input: ReplacePolicySnapshotInput,
    trx?: KyselyTransaction,
  ): Promise<KnowledgeSourceAccessPolicy> {
    const db = dbOrTx(this.db, trx);

    await db
      .deleteFrom('knowledgeSourceAccessPrincipals')
      .where('workspaceId', '=', input.workspaceId)
      .where('sourcePageId', '=', input.sourcePageId)
      .execute();

    await db
      .deleteFrom('knowledgeSourceAccessRequirements')
      .where('workspaceId', '=', input.workspaceId)
      .where('sourcePageId', '=', input.sourcePageId)
      .execute();

    const policy = await this.upsertPolicy(
      {
        workspaceId: input.workspaceId,
        sourcePageId: input.sourcePageId,
        sourceSpaceId: input.sourceSpaceId,
        policyHash: input.policyHash,
        restrictedAncestorCount: input.restrictedAncestorCount,
      },
      trx,
    );

    const requirementRows: InsertableKnowledgeSourceAccessRequirement[] =
      input.requirements.map((requirement) => ({
        workspaceId: input.workspaceId,
        sourcePageId: input.sourcePageId,
        requirementId: requirement.requirementId,
        restrictedPageId: requirement.restrictedPageId,
        depth: requirement.depth,
      }));

    if (requirementRows.length > 0) {
      await db
        .insertInto('knowledgeSourceAccessRequirements')
        .values(requirementRows)
        .execute();
    }

    const principalRows: InsertableKnowledgeSourceAccessPrincipal[] =
      input.requirements.flatMap((requirement) =>
        requirement.principals.map((principal) => ({
          workspaceId: input.workspaceId,
          sourcePageId: input.sourcePageId,
          requirementId: requirement.requirementId,
          principalType: principal.principalType,
          principalId: principal.principalId,
          role: principal.role,
        })),
      );

    if (principalRows.length > 0) {
      await db
        .insertInto('knowledgeSourceAccessPrincipals')
        .values(principalRows)
        .execute();
    }

    return policy;
  }
}
