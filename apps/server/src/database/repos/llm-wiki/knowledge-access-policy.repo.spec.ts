import { KnowledgeAccessPolicyRepo } from './knowledge-access-policy.repo';

type QueryCall = {
  method: string;
  args: unknown[];
};

class FakeKyselyQuery {
  readonly calls: QueryCall[] = [];

  constructor(
    private readonly results: unknown[] | Record<string, unknown[]> = [],
  ) {}

  insertInto(...args: unknown[]) {
    this.calls.push({ method: 'insertInto', args });
    return this;
  }

  values(...args: unknown[]) {
    this.calls.push({ method: 'values', args });
    return this;
  }

  onConflict(...args: unknown[]) {
    this.calls.push({ method: 'onConflict', args });
    return this;
  }

  returningAll(...args: unknown[]) {
    this.calls.push({ method: 'returningAll', args });
    return this;
  }

  selectFrom(...args: unknown[]) {
    this.calls.push({ method: 'selectFrom', args });
    return this;
  }

  select(...args: unknown[]) {
    this.calls.push({ method: 'select', args });
    return this;
  }

  selectAll(...args: unknown[]) {
    this.calls.push({ method: 'selectAll', args });
    return this;
  }

  updateTable(...args: unknown[]) {
    this.calls.push({ method: 'updateTable', args });
    return this;
  }

  deleteFrom(...args: unknown[]) {
    this.calls.push({ method: 'deleteFrom', args });
    return this;
  }

  set(...args: unknown[]) {
    this.calls.push({ method: 'set', args });
    return this;
  }

  where(...args: unknown[]) {
    this.calls.push({ method: 'where', args });
    return this;
  }

  async execute() {
    this.calls.push({ method: 'execute', args: [] });
    return this.resultForLastTable();
  }

  async executeTakeFirstOrThrow() {
    this.calls.push({ method: 'executeTakeFirstOrThrow', args: [] });
    return this.resultForLastTable()[0];
  }

  private resultForLastTable(): unknown[] {
    if (Array.isArray(this.results)) return this.results;

    const lastTableCall = [...this.calls]
      .reverse()
      .find((call) =>
        ['selectFrom', 'updateTable', 'insertInto', 'deleteFrom'].includes(
          call.method,
        ),
      );
    return this.results[String(lastTableCall?.args[0])] ?? [];
  }
}

function createRepo(query: FakeKyselyQuery) {
  return new KnowledgeAccessPolicyRepo(query as never);
}

describe('KnowledgeAccessPolicyRepo', () => {
  it('upserts policies into the knowledgeSourceAccessPolicy table', async () => {
    const row = { sourcePageId: 'page-1', workspaceId: 'workspace-1' };
    const query = new FakeKyselyQuery([row]);
    const repo = createRepo(query);

    await expect(
      repo.upsertPolicy({
        workspaceId: 'workspace-1',
        sourcePageId: 'page-1',
        sourceSpaceId: 'space-1',
        policyHash: 'policy-hash',
        restrictedAncestorCount: 2,
      }),
    ).resolves.toEqual(row);

    expect(query.calls).toEqual([
      { method: 'insertInto', args: ['knowledgeSourceAccessPolicy'] },
      {
        method: 'values',
        args: [
          {
            workspaceId: 'workspace-1',
            sourcePageId: 'page-1',
            sourceSpaceId: 'space-1',
            policyHash: 'policy-hash',
            restrictedAncestorCount: 2,
            staleAt: null,
          },
        ],
      },
      { method: 'onConflict', args: [expect.any(Function)] },
      { method: 'returningAll', args: [] },
      { method: 'executeTakeFirstOrThrow', args: [] },
    ]);
  });

  it('does not query policies for an empty source list', async () => {
    const query = new FakeKyselyQuery();
    const repo = createRepo(query);

    await expect(
      repo.findPoliciesForSources({
        workspaceId: 'workspace-1',
        sourcePageIds: [],
      }),
    ).resolves.toEqual([]);

    expect(query.calls).toEqual([]);
  });

  it('finds policies within the requested workspace', async () => {
    const rows = [{ sourcePageId: 'page-1' }];
    const query = new FakeKyselyQuery(rows);
    const repo = createRepo(query);

    await expect(
      repo.findPoliciesForSources({
        workspaceId: 'workspace-1',
        sourcePageIds: ['page-1', 'page-2'],
      }),
    ).resolves.toEqual(rows);

    expect(query.calls).toEqual([
      { method: 'selectFrom', args: ['knowledgeSourceAccessPolicy'] },
      { method: 'selectAll', args: [] },
      { method: 'where', args: ['workspaceId', '=', 'workspace-1'] },
      { method: 'where', args: ['sourcePageId', 'in', ['page-1', 'page-2']] },
      { method: 'execute', args: [] },
    ]);
  });

  it('replaces requirements and principals for a source policy snapshot', async () => {
    const row = { sourcePageId: 'page-1', workspaceId: 'workspace-1' };
    const query = new FakeKyselyQuery([row]);
    const repo = createRepo(query);

    await expect(
      repo.replacePolicySnapshot({
        workspaceId: 'workspace-1',
        sourcePageId: 'page-1',
        sourceSpaceId: 'space-1',
        policyHash: 'hash-1',
        restrictedAncestorCount: 2,
        requirements: [
          {
            requirementId: 'access-1',
            restrictedPageId: 'restricted-1',
            depth: 0,
            principals: [
              {
                principalType: 'user',
                principalId: 'user-1',
                role: 'reader',
              },
              {
                principalType: 'group',
                principalId: 'group-1',
                role: 'writer',
              },
            ],
          },
          {
            requirementId: 'access-empty',
            restrictedPageId: 'restricted-empty',
            depth: 1,
            principals: [],
          },
        ],
      }),
    ).resolves.toEqual(row);

    expect(query.calls).toEqual([
      { method: 'deleteFrom', args: ['knowledgeSourceAccessPrincipals'] },
      { method: 'where', args: ['workspaceId', '=', 'workspace-1'] },
      { method: 'where', args: ['sourcePageId', '=', 'page-1'] },
      { method: 'execute', args: [] },
      { method: 'deleteFrom', args: ['knowledgeSourceAccessRequirements'] },
      { method: 'where', args: ['workspaceId', '=', 'workspace-1'] },
      { method: 'where', args: ['sourcePageId', '=', 'page-1'] },
      { method: 'execute', args: [] },
      { method: 'insertInto', args: ['knowledgeSourceAccessPolicy'] },
      {
        method: 'values',
        args: [
          {
            workspaceId: 'workspace-1',
            sourcePageId: 'page-1',
            sourceSpaceId: 'space-1',
            policyHash: 'hash-1',
            restrictedAncestorCount: 2,
            staleAt: null,
          },
        ],
      },
      { method: 'onConflict', args: [expect.any(Function)] },
      { method: 'returningAll', args: [] },
      { method: 'executeTakeFirstOrThrow', args: [] },
      {
        method: 'insertInto',
        args: ['knowledgeSourceAccessRequirements'],
      },
      {
        method: 'values',
        args: [
          [
            {
              workspaceId: 'workspace-1',
              sourcePageId: 'page-1',
              requirementId: 'access-1',
              restrictedPageId: 'restricted-1',
              depth: 0,
            },
            {
              workspaceId: 'workspace-1',
              sourcePageId: 'page-1',
              requirementId: 'access-empty',
              restrictedPageId: 'restricted-empty',
              depth: 1,
            },
          ],
        ],
      },
      { method: 'execute', args: [] },
      {
        method: 'insertInto',
        args: ['knowledgeSourceAccessPrincipals'],
      },
      {
        method: 'values',
        args: [
          [
            {
              workspaceId: 'workspace-1',
              sourcePageId: 'page-1',
              requirementId: 'access-1',
              principalType: 'user',
              principalId: 'user-1',
              role: 'reader',
            },
            {
              workspaceId: 'workspace-1',
              sourcePageId: 'page-1',
              requirementId: 'access-1',
              principalType: 'group',
              principalId: 'group-1',
              role: 'writer',
            },
          ],
        ],
      },
      { method: 'execute', args: [] },
    ]);
  });
});
