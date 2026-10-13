import { KnowledgeRunRetentionScheduler } from './knowledge-run-retention.scheduler';

describe('KnowledgeRunRetentionScheduler', () => {
  it('stops when a batch finds no more eligible history', async () => {
    const fixture = createFixture();
    fixture.retention.purgeExpiredRunHistoryBatch
      .mockResolvedValueOnce(batch({ deletedImages: 10 }))
      .mockResolvedValueOnce(batch());

    await fixture.scheduler.purgeExpiredRunHistory();

    expect(fixture.retention.purgeExpiredRunHistoryBatch).toHaveBeenCalledTimes(
      2,
    );
  });

  it('runs at most twenty batches in one daily schedule', async () => {
    const fixture = createFixture();
    fixture.retention.purgeExpiredRunHistoryBatch.mockResolvedValue(
      batch({ deletedImages: 1 }),
    );

    await fixture.scheduler.purgeExpiredRunHistory();

    expect(fixture.retention.purgeExpiredRunHistoryBatch).toHaveBeenCalledTimes(
      20,
    );
  });

  it('can run again after a failed batch', async () => {
    const fixture = createFixture();
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

function createFixture() {
  const retention = {
    purgeExpiredRunHistoryBatch: jest.fn(),
  };
  return {
    retention,
    scheduler: new KnowledgeRunRetentionScheduler(retention as never),
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
