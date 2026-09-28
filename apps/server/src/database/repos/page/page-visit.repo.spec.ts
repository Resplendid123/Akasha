import { PageVisitRepo } from './page-visit.repo';

type QueryCall = { method: string; args: unknown[] };

class FakeKyselyQuery {
  readonly calls: QueryCall[] = [];

  insertInto(...args: unknown[]) {
    this.calls.push({ method: 'insertInto', args });
    return this;
  }

  values(...args: unknown[]) {
    this.calls.push({ method: 'values', args });
    return this;
  }

  onConflict(callback: (builder: any) => unknown) {
    this.calls.push({ method: 'onConflict', args: [] });
    callback({
      columns: (columns: string[]) => {
        this.calls.push({ method: 'conflictColumns', args: [columns] });
        return {
          doUpdateSet: (values: Record<string, unknown>) => {
            this.calls.push({
              method: 'doUpdateSet',
              args: [Object.keys(values)],
            });
            return this;
          },
        };
      },
    });
    return this;
  }

  async execute() {
    this.calls.push({ method: 'execute', args: [] });
  }
}

describe('PageVisitRepo', () => {
  it('updates the visit time when the same user opens the same page again', async () => {
    const query = new FakeKyselyQuery();
    const repo = new PageVisitRepo(query as never);
    const visitedAt = new Date('2026-09-21T08:30:00.000Z');

    await repo.upsert({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      pageId: 'page-1',
      visitedAt,
    });

    expect(query.calls).toEqual([
      { method: 'insertInto', args: ['pageVisits'] },
      {
        method: 'values',
        args: [
          {
            workspaceId: 'workspace-1',
            userId: 'user-1',
            pageId: 'page-1',
            lastVisitedAt: visitedAt,
          },
        ],
      },
      { method: 'onConflict', args: [] },
      { method: 'conflictColumns', args: [['userId', 'pageId']] },
      { method: 'doUpdateSet', args: [['lastVisitedAt']] },
      { method: 'execute', args: [] },
    ]);
  });
});
