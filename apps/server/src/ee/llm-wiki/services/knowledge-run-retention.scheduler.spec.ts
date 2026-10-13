import { KnowledgeRunRetentionScheduler } from './knowledge-run-retention.scheduler';

describe('KnowledgeRunRetentionScheduler', () => {
  it('does not access retention data while disabled', async () => {
    const fixture = createFixture({ enabled: false });

    await fixture.scheduler.purgeExpiredRunHistory();

    expect(
      fixture.retention.purgeExpiredRunHistoryBatch,
    ).not.toHaveBeenCalled();
  });

  it('stops when a batch finds no more eligible history', async () => {
    const fixture = createFixture({ enabled: true });
    fixture.retention.purgeExpiredRunHistoryBatch
      .mockResolvedValueOnce(batch({ deletedImages: 10 }))
      .mockResolvedValueOnce(batch());

    await fixture.scheduler.purgeExpiredRunHistory();

    expect(fixture.retention.purgeExpiredRunHistoryBatch).toHaveBeenCalledTimes(
      2,
    );
  });

  it('runs at most twenty batches in one daily schedule', async () => {
    const fixture = createFixture({ enabled: true });
    fixture.retention.purgeExpiredRunHistoryBatch.mockResolvedValue(
      batch({ deletedImages: 1 }),
    );

    await fixture.scheduler.purgeExpiredRunHistory();

    expect(fixture.retention.purgeExpiredRunHistoryBatch).toHaveBeenCalledTimes(
      20,
    );
  });

  it('can run again after a failed batch', async () => {
    const fixture = createFixture({ enabled: true });
    fixture.retention.purgeExpiredRunHistoryBatch
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(batch());

    await fixture.scheduler.purgeExpiredRunHistory();
    await fixture.scheduler.purgeExpiredRunHistory();

    expect(fixture.retention.purgeExpiredRunHistoryBatch).toHaveBeenCalledTimes(
      2,
    );
  });
});

function createFixture(input: { enabled: boolean }) {
  const retention = {
    purgeExpiredRunHistoryBatch: jest.fn(),
  };
  const environment = {
    isKnowledgeRunRetentionEnabled: jest.fn().mockReturnValue(input.enabled),
  };
  return {
    retention,
    scheduler: new KnowledgeRunRetentionScheduler(
      retention as never,
      environment as never,
    ),
  };
}

function batch(
  overrides: Partial<{
    deletedImages: number;
    deletedPages: number;
    deletedRuns: number;
    durationMs: number;
  }> = {},
) {
  return {
    deletedImages: 0,
    deletedPages: 0,
    deletedRuns: 0,
    durationMs: 1,
    ...overrides,
  };
}
