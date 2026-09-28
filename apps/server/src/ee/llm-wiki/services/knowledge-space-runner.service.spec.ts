import { KnowledgeSpaceRunnerService } from './knowledge-space-runner.service';

describe('KnowledgeSpaceRunnerService', () => {
  it('compiles strictly serially and yields after five terminal pages', async () => {
    let activeCompiles = 0;
    let maxActiveCompiles = 0;
    const completed: string[] = [];
    const pages = Array.from({ length: 6 }, (_, index) => ({
      sourcePageId: `page-${index + 1}`,
      bindingStatus: 'bound',
      expectedSourceVersion: 'v1',
      expectedSourceContentHash: `sha256:page-${index + 1}`,
      createdAt: new Date(index),
    }));
    const lease = leaseFixture();
    const executionRepo = createExecutionRepo(lease, pages);
    executionRepo.findPendingTextPages.mockImplementation(async () =>
      pages.slice(completed.length),
    );
    const pageCompilation = {
      compileTextPage: jest.fn(async (input) => {
        activeCompiles += 1;
        maxActiveCompiles = Math.max(maxActiveCompiles, activeCompiles);
        await Promise.resolve();
        completed.push(input.data.sourcePageIds[0]);
        await input.execution.completePage({ status: 'succeeded' });
        activeCompiles -= 1;
        executionRepo.claimNextTextPage.mockResolvedValue(
          pages[completed.length],
        );
        return { outcome: 'succeeded', result: pageResult() };
      }),
    };
    const runner = new KnowledgeSpaceRunnerService(
      executionRepo as never,
      {
        initializeLeasedRun: jest.fn().mockResolvedValue({
          initialized: true,
        }),
      } as never,
      pageCompilation as never,
      finalizer() as never,
      { getKnowledgePageDeadlineMs: () => 900_000 } as never,
    );

    await expect(
      runner.runTextLease(leaseInput(), {
        workerId: 'worker-1',
        settings: settings(),
        monotonicNow: () => 0,
      }),
    ).resolves.toEqual({ outcome: 'yielded', completedPages: 5 });
    expect(maxActiveCompiles).toBe(1);
    expect(completed).toEqual([
      'page-1',
      'page-2',
      'page-3',
      'page-4',
      'page-5',
    ]);
    expect(executionRepo.yieldSpaceLease).toHaveBeenCalledWith(lease, {
      reason: 'page_limit',
    });
  });

  it('records a retryable text failure and keeps compiling later pages', async () => {
    const pages = Array.from({ length: 6 }, (_, index) => ({
      sourcePageId: `retry-page-${index + 1}`,
      bindingStatus: 'bound',
      expectedSourceVersion: 'v1',
      expectedSourceContentHash: `sha256:retry-page-${index + 1}`,
      createdAt: new Date(index),
    }));
    const lease = leaseFixture();
    const executionRepo = createExecutionRepo(lease, pages);
    let completedPages = 0;
    executionRepo.findPendingTextPages.mockImplementation(async () =>
      pages.slice(completedPages),
    );
    const pageCompilation = {
      compileTextPage: jest.fn(async (input) => {
        const firstPage = completedPages === 0;
        await input.execution.completePage({
          status: firstPage ? 'failed' : 'succeeded',
        });
        completedPages += 1;
        executionRepo.claimNextTextPage.mockResolvedValue(
          pages[completedPages],
        );
        return firstPage
          ? {
              outcome: 'failed',
              retryable: true,
              cause: new Error('provider retries exhausted'),
            }
          : { outcome: 'succeeded', result: pageResult() };
      }),
    };
    const runner = new KnowledgeSpaceRunnerService(
      executionRepo as never,
      {
        initializeLeasedRun: jest.fn().mockResolvedValue({
          initialized: true,
        }),
      } as never,
      pageCompilation as never,
      finalizer() as never,
      { getKnowledgePageDeadlineMs: () => 900_000 } as never,
    );

    await expect(
      runner.runTextLease(leaseInput(), {
        workerId: 'worker-1',
        settings: settings(),
        monotonicNow: () => 0,
      }),
    ).resolves.toEqual({ outcome: 'yielded', completedPages: 5 });
    expect(pageCompilation.compileTextPage).toHaveBeenCalledTimes(5);
  });

  it('finalizes an all-reused run without compiling pages', async () => {
    const lease = leaseFixture();
    const executionRepo = createExecutionRepo(lease, []);
    const pageCompilation = { compileTextPage: jest.fn() };
    const spaceFinalizer = finalizer();
    const runner = new KnowledgeSpaceRunnerService(
      executionRepo as never,
      {
        initializeLeasedRun: jest.fn().mockResolvedValue({
          initialized: true,
        }),
      } as never,
      pageCompilation as never,
      spaceFinalizer as never,
      { getKnowledgePageDeadlineMs: () => 900_000 } as never,
    );

    await expect(
      runner.runTextLease(leaseInput(), {
        workerId: 'worker-1',
        settings: settings(),
        monotonicNow: () => 0,
      }),
    ).resolves.toEqual({ outcome: 'completed', completedPages: 0 });
    expect(pageCompilation.compileTextPage).not.toHaveBeenCalled();
    expect(spaceFinalizer.finalizeLeased).toHaveBeenCalledWith(lease, {
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
    });
    expect(executionRepo.finishRun).toHaveBeenCalledWith(lease, 'succeeded');
  });

  it('binds an unbound page and skips compilation when the snapshot is reused', async () => {
    const lease = leaseFixture();
    const executionRepo = createExecutionRepo(lease, [
      {
        sourcePageId: 'page-1',
        bindingStatus: 'binding',
        expectedSourceVersion: null,
        expectedSourceContentHash: null,
        createdAt: new Date(0),
      },
    ]);
    const pageCompilation = { compileTextPage: jest.fn() };
    const spaceCompilation = {
      initializeLeasedRun: jest.fn().mockResolvedValue({
        initialized: true,
      }),
      bindLeasedRunPage: jest.fn().mockResolvedValue({ outcome: 'reused' }),
    };
    const runner = new KnowledgeSpaceRunnerService(
      executionRepo as never,
      spaceCompilation as never,
      pageCompilation as never,
      finalizer() as never,
      { getKnowledgePageDeadlineMs: () => 900_000 } as never,
    );
    executionRepo.claimNextTextPage
      .mockResolvedValueOnce({
        sourcePageId: 'page-1',
        bindingStatus: 'binding',
        expectedSourceVersion: null,
        expectedSourceContentHash: null,
        createdAt: new Date(0),
      })
      .mockResolvedValue(undefined);
    executionRepo.findPendingTextPages.mockResolvedValue([]);

    await expect(
      runner.runTextLease(leaseInput(), {
        workerId: 'worker-1',
        settings: settings(),
        monotonicNow: () => 0,
      }),
    ).resolves.toEqual({ outcome: 'completed', completedPages: 1 });
    expect(spaceCompilation.bindLeasedRunPage).toHaveBeenCalledWith(lease, {
      sourcePageId: 'page-1',
    });
    expect(pageCompilation.compileTextPage).not.toHaveBeenCalled();
  });

  it('renews the database lease during a long activation', async () => {
    jest.useFakeTimers();
    const lease = leaseFixture();
    const executionRepo = createExecutionRepo(lease, []);
    let resolveInitialization!: (value: unknown) => void;
    const initialization = new Promise((resolve) => {
      resolveInitialization = resolve;
    });
    const runner = new KnowledgeSpaceRunnerService(
      executionRepo as never,
      { initializeLeasedRun: jest.fn(() => initialization) } as never,
      { compileTextPage: jest.fn() } as never,
      finalizer() as never,
      { getKnowledgePageDeadlineMs: () => 900_000 } as never,
    );
    const running = runner.runTextLease(leaseInput(), {
      workerId: 'worker-1',
      settings: settings(),
      monotonicNow: () => 0,
    });
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(executionRepo.heartbeatSpaceLease).toHaveBeenCalled();
    resolveInitialization({
      initialized: true,
    });
    await running;
    jest.useRealTimers();
  });

  it('keeps a lease alive when a background heartbeat temporarily fails', async () => {
    jest.useFakeTimers();
    const lease = leaseFixture();
    const executionRepo = createExecutionRepo(lease, []);
    executionRepo.heartbeatSpaceLease.mockRejectedValueOnce(
      new Error('database pool temporarily unavailable'),
    );
    let resolveInitialization!: (value: unknown) => void;
    const initialization = new Promise((resolve) => {
      resolveInitialization = resolve;
    });
    const runner = new KnowledgeSpaceRunnerService(
      executionRepo as never,
      { initializeLeasedRun: jest.fn(() => initialization) } as never,
      { compileTextPage: jest.fn() } as never,
      finalizer() as never,
      { getKnowledgePageDeadlineMs: () => 900_000 } as never,
    );
    const running = runner.runTextLease(leaseInput(), {
      workerId: 'worker-1',
      settings: settings(),
      monotonicNow: () => 0,
    });
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(30_000);
    resolveInitialization({
      initialized: true,
    });

    await expect(running).resolves.toEqual({
      outcome: 'completed',
      completedPages: 0,
    });
    jest.useRealTimers();
  });

  it('merges image pages strictly serially and yields after five terminal pages', async () => {
    let activeMerges = 0;
    let maxActiveMerges = 0;
    const completed: string[] = [];
    const pages = Array.from({ length: 6 }, (_, index) => ({
      id: `run-page-${index + 1}`,
      sourcePageId: `page-${index + 1}`,
      expectedSourceVersion: 'v1',
      expectedSourceContentHash: `sha256:page-${index + 1}`,
      targetEffectiveKnowledgeHash: null,
      createdAt: new Date(index),
      images: [],
    }));
    const lease = mergeLeaseFixture();
    const executionRepo = createExecutionRepo(lease, []);
    executionRepo.claimNextMergePage = jest.fn().mockResolvedValue(pages);
    executionRepo.findPendingMergePages = jest
      .fn()
      .mockImplementation(async () => pages.slice(completed.length));
    executionRepo.completeMergePagePublicationInTransaction = jest
      .fn()
      .mockResolvedValue(true);
    executionRepo.isLeaseActiveForMergePublication = jest
      .fn()
      .mockResolvedValue(true);
    executionRepo.failMergePage = jest.fn().mockResolvedValue({});
    executionRepo.skipMergePage = jest.fn().mockResolvedValue({});
    const pageCompilation = {
      mergePageImages: jest.fn(async (input) => {
        activeMerges += 1;
        maxActiveMerges = Math.max(maxActiveMerges, activeMerges);
        await Promise.resolve();
        completed.push(input.data.sourcePageId);
        activeMerges -= 1;
        executionRepo.claimNextMergePage.mockResolvedValue(
          pages.slice(completed.length),
        );
        return { outcome: 'succeeded', result: pageResult() };
      }),
    };
    const spaceFinalizer = finalizer();
    const runner = new KnowledgeSpaceRunnerService(
      executionRepo as never,
      { initializeLeasedRun: jest.fn() } as never,
      pageCompilation as never,
      spaceFinalizer as never,
      { getKnowledgePageDeadlineMs: () => 900_000 } as never,
    );

    await expect(
      runner.runImageMergeLease(mergeLeaseInput(), {
        workerId: 'worker-1',
        settings: settings(),
        monotonicNow: () => 0,
      }),
    ).resolves.toEqual({ outcome: 'yielded', completedPages: 5 });
    expect(maxActiveMerges).toBe(1);
    expect(completed).toEqual([
      'page-1',
      'page-2',
      'page-3',
      'page-4',
      'page-5',
    ]);
    expect(executionRepo.yieldSpaceLease).toHaveBeenCalledWith(lease, {
      reason: 'page_limit',
    });
    expect(spaceFinalizer.finalizeLeased).not.toHaveBeenCalled();
  });

  it('records a retryable merge failure and keeps merging later pages', async () => {
    const pages = Array.from({ length: 6 }, (_, index) => ({
      id: `retry-run-page-${index + 1}`,
      sourcePageId: `retry-merge-page-${index + 1}`,
      expectedSourceVersion: 'v1',
      expectedSourceContentHash: `sha256:retry-merge-page-${index + 1}`,
      targetEffectiveKnowledgeHash: null,
      createdAt: new Date(index),
      images: [],
    }));
    const lease = mergeLeaseFixture();
    const executionRepo = createExecutionRepo(lease, []);
    executionRepo.claimNextMergePage = jest.fn().mockResolvedValue(pages);
    let completedPages = 0;
    executionRepo.findPendingMergePages = jest
      .fn()
      .mockImplementation(async () => pages.slice(completedPages));
    const pageCompilation = {
      mergePageImages: jest.fn(async (input) => {
        const firstPage = completedPages === 0;
        if (firstPage) {
          await input.execution.completePage({ status: 'failed' });
        }
        completedPages += 1;
        executionRepo.claimNextMergePage.mockResolvedValue(
          pages.slice(completedPages),
        );
        return firstPage
          ? {
              outcome: 'failed',
              retryable: true,
              cause: new Error('provider retries exhausted'),
            }
          : { outcome: 'succeeded', result: pageResult() };
      }),
    };
    const runner = new KnowledgeSpaceRunnerService(
      executionRepo as never,
      { initializeLeasedRun: jest.fn() } as never,
      pageCompilation as never,
      finalizer() as never,
      { getKnowledgePageDeadlineMs: () => 900_000 } as never,
    );

    await expect(
      runner.runImageMergeLease(mergeLeaseInput(), {
        workerId: 'worker-1',
        settings: settings(),
        monotonicNow: () => 0,
      }),
    ).resolves.toEqual({ outcome: 'yielded', completedPages: 5 });
    expect(pageCompilation.mergePageImages).toHaveBeenCalledTimes(5);
  });

  it('runs finalization only after the image merge barrier', async () => {
    const lease = mergeLeaseFixture();
    const executionRepo = createExecutionRepo(lease, []);
    executionRepo.claimNextMergePage = jest.fn().mockResolvedValue([]);
    executionRepo.advanceMergeBarrier = jest
      .fn()
      .mockResolvedValue({ barrierComplete: true });
    executionRepo.hasPartialOutcome = jest.fn().mockResolvedValue(true);
    const spaceFinalizer = finalizer();
    const runner = new KnowledgeSpaceRunnerService(
      executionRepo as never,
      { initializeLeasedRun: jest.fn() } as never,
      { mergePageImages: jest.fn() } as never,
      spaceFinalizer as never,
      { getKnowledgePageDeadlineMs: () => 900_000 } as never,
    );

    await expect(
      runner.runImageMergeLease(mergeLeaseInput(), {
        workerId: 'worker-1',
        settings: settings(),
      }),
    ).resolves.toEqual({ outcome: 'completed', completedPages: 0 });
    expect(executionRepo.advanceMergeBarrier).toHaveBeenCalledWith(lease);
    expect(spaceFinalizer.finalizeLeased).toHaveBeenCalledWith(lease, {
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
    });
    expect(executionRepo.finishRun).toHaveBeenCalledWith(lease, 'partial');
  });

  it('persists a skipped image merge as skipped instead of failed', async () => {
    const lease = mergeLeaseFixture();
    const executionRepo = createExecutionRepo(lease, [
      {
        id: 'run-page-1',
        sourcePageId: 'page-1',
        expectedSourceVersion: 'v1',
        expectedSourceContentHash: 'sha256:page-1',
        targetEffectiveKnowledgeHash: null,
        createdAt: new Date(0),
        images: [],
      },
    ]);
    executionRepo.claimNextMergePage = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'run-page-1',
          sourcePageId: 'page-1',
          expectedSourceVersion: 'v1',
          expectedSourceContentHash: 'sha256:page-1',
          targetEffectiveKnowledgeHash: null,
          createdAt: new Date(0),
          images: [],
        },
      ])
      .mockResolvedValue([]);
    executionRepo.findPendingMergePages = jest.fn().mockResolvedValue([]);
    const pageCompilation = {
      mergePageImages: jest.fn(async (input) => {
        await input.execution.completePage({
          status: 'skipped',
          errorCode: 'image_snapshot_changed',
        });
        return { outcome: 'succeeded', result: pageResult() };
      }),
    };
    const runner = new KnowledgeSpaceRunnerService(
      executionRepo as never,
      { initializeLeasedRun: jest.fn() } as never,
      pageCompilation as never,
      finalizer() as never,
      { getKnowledgePageDeadlineMs: () => 900_000 } as never,
    );

    await runner.runImageMergeLease(mergeLeaseInput(), {
      workerId: 'worker-1',
      settings: settings(),
    });

    expect(executionRepo.skipMergePage).toHaveBeenCalledWith(
      lease,
      expect.objectContaining({ errorCode: 'image_snapshot_changed' }),
    );
    expect(executionRepo.failMergePage).not.toHaveBeenCalled();
  });

  it('reaches the text barrier with a failed page in the middle of the pass', async () => {
    const pages = Array.from({ length: 3 }, (_, index) => ({
      sourcePageId: `barrier-page-${index + 1}`,
      bindingStatus: 'bound',
      expectedSourceVersion: 'v1',
      expectedSourceContentHash: `sha256:barrier-page-${index + 1}`,
      createdAt: new Date(index),
    }));
    const lease = leaseFixture();
    const executionRepo = createExecutionRepo(lease, pages);
    let index = 0;
    executionRepo.findPendingTextPages.mockImplementation(async () =>
      pages.slice(index),
    );
    const pageCompilation = {
      compileTextPage: jest.fn(async (input) => {
        const failing = index === 1;
        await input.execution.completePage({
          status: failing ? 'failed' : 'succeeded',
          ...(failing ? { retryable: true } : {}),
        });
        index += 1;
        executionRepo.claimNextTextPage.mockResolvedValue(pages[index]);
        return failing
          ? {
              outcome: 'failed',
              retryable: true,
              cause: new Error('provider unavailable'),
            }
          : { outcome: 'succeeded', result: pageResult() };
      }),
    };
    const runner = new KnowledgeSpaceRunnerService(
      executionRepo as never,
      {
        initializeLeasedRun: jest.fn().mockResolvedValue({
          initialized: true,
        }),
      } as never,
      pageCompilation as never,
      finalizer() as never,
      { getKnowledgePageDeadlineMs: () => 900_000 } as never,
    );

    await expect(
      runner.runTextLease(leaseInput(), {
        workerId: 'worker-1',
        settings: settings(),
        monotonicNow: () => 0,
      }),
    ).resolves.toEqual({ outcome: 'completed', completedPages: 3 });
    expect(pageCompilation.compileTextPage).toHaveBeenCalledTimes(3);
    expect(executionRepo.advanceTextBarrier).toHaveBeenCalledWith(lease);
  });

  it('re-enters the claim loop when the text barrier settles pages', async () => {
    const lease = leaseFixture();
    const executionRepo = createExecutionRepo(lease, []);
    const settledPage = {
      sourcePageId: 'settled-page',
      bindingStatus: 'bound',
      expectedSourceVersion: 'v1',
      expectedSourceContentHash: 'sha256:settled-page',
      createdAt: new Date(0),
    };
    executionRepo.claimNextTextPage
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(settledPage)
      .mockResolvedValue(undefined);
    executionRepo.advanceTextBarrier
      .mockResolvedValueOnce({
        barrierComplete: false,
        reclaimed: true,
        imagesRequired: false,
      })
      .mockResolvedValue({ barrierComplete: true, imagesRequired: false });
    const pageCompilation = {
      compileTextPage: jest.fn(async (input) => {
        await input.execution.completePage({ status: 'succeeded' });
        return { outcome: 'succeeded', result: pageResult() };
      }),
    };
    const runner = new KnowledgeSpaceRunnerService(
      executionRepo as never,
      {
        initializeLeasedRun: jest.fn().mockResolvedValue({
          initialized: true,
        }),
      } as never,
      pageCompilation as never,
      finalizer() as never,
      { getKnowledgePageDeadlineMs: () => 900_000 } as never,
    );

    await expect(
      runner.runTextLease(leaseInput(), {
        workerId: 'worker-1',
        settings: settings(),
        monotonicNow: () => 0,
      }),
    ).resolves.toEqual({ outcome: 'completed', completedPages: 1 });
    expect(pageCompilation.compileTextPage).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sourcePageIds: ['settled-page'] }),
      }),
      expect.anything(),
    );
    expect(executionRepo.advanceTextBarrier).toHaveBeenCalledTimes(2);
    expect(executionRepo.finishRun).toHaveBeenCalledWith(lease, 'succeeded');
  });

  it('yields mid-settlement and leaves the settled page for the next lease', async () => {
    const lease = leaseFixture();
    const executionRepo = createExecutionRepo(lease, []);
    const settledPages = Array.from({ length: 6 }, (_, index) => ({
      sourcePageId: `resettled-${index + 1}`,
      bindingStatus: 'bound',
      expectedSourceVersion: 'v1',
      expectedSourceContentHash: `sha256:resettled-${index + 1}`,
      createdAt: new Date(index),
    }));
    let served = 0;
    const peek = () => (served === 0 ? undefined : settledPages[served - 1]);
    executionRepo.claimNextTextPage.mockImplementation(async () => peek());
    executionRepo.findPendingTextPages.mockImplementation(async () => {
      const next = peek();
      return next ? [next] : [];
    });
    executionRepo.advanceTextBarrier.mockResolvedValue({
      barrierComplete: false,
      reclaimed: true,
      imagesRequired: false,
    });
    const pageCompilation = {
      compileTextPage: jest.fn(async (input) => {
        await input.execution.completePage({ status: 'succeeded' });
        served += 1;
        return { outcome: 'succeeded', result: pageResult() };
      }),
    };
    const runner = new KnowledgeSpaceRunnerService(
      executionRepo as never,
      {
        initializeLeasedRun: jest.fn().mockResolvedValue({
          initialized: true,
        }),
      } as never,
      pageCompilation as never,
      finalizer() as never,
      { getKnowledgePageDeadlineMs: () => 900_000 } as never,
    );
    served = 1;

    await expect(
      runner.runTextLease(leaseInput(), {
        workerId: 'worker-1',
        settings: settings(),
        monotonicNow: () => 0,
      }),
    ).resolves.toEqual({ outcome: 'yielded', completedPages: 5 });
    expect(executionRepo.yieldSpaceLease).toHaveBeenCalledWith(lease, {
      reason: 'page_limit',
    });
    expect(executionRepo.finishRun).not.toHaveBeenCalled();
  });

  it('reaches the merge barrier with a failed merge page in the middle of the pass', async () => {
    const pages = Array.from({ length: 3 }, (_, index) => ({
      id: `run-page-mb-${index + 1}`,
      sourcePageId: `mb-page-${index + 1}`,
      expectedSourceVersion: 'v1',
      expectedSourceContentHash: `sha256:mb-page-${index + 1}`,
      targetEffectiveKnowledgeHash: null,
      createdAt: new Date(index),
      images: [],
    }));
    const lease = mergeLeaseFixture();
    const executionRepo = createExecutionRepo(lease, []);
    executionRepo.claimNextMergePage = jest.fn().mockResolvedValue(pages);
    executionRepo.advanceMergeBarrier = jest
      .fn()
      .mockResolvedValue({ barrierComplete: true });
    let index = 0;
    executionRepo.findPendingMergePages = jest
      .fn()
      .mockImplementation(async () => pages.slice(index));
    const pageCompilation = {
      mergePageImages: jest.fn(async (input) => {
        const failing = index === 1;
        if (failing) {
          await input.execution.completePage({
            status: 'failed',
            retryable: true,
          });
        }
        index += 1;
        executionRepo.claimNextMergePage.mockResolvedValue(pages.slice(index));
        return failing
          ? {
              outcome: 'failed',
              retryable: true,
              cause: new Error('provider unavailable'),
            }
          : { outcome: 'succeeded', result: pageResult() };
      }),
    };
    const runner = new KnowledgeSpaceRunnerService(
      executionRepo as never,
      { initializeLeasedRun: jest.fn() } as never,
      pageCompilation as never,
      finalizer() as never,
      { getKnowledgePageDeadlineMs: () => 900_000 } as never,
    );

    await expect(
      runner.runImageMergeLease(mergeLeaseInput(), {
        workerId: 'worker-1',
        settings: settings(),
        monotonicNow: () => 0,
      }),
    ).resolves.toEqual({ outcome: 'completed', completedPages: 3 });
    expect(pageCompilation.mergePageImages).toHaveBeenCalledTimes(3);
    expect(executionRepo.advanceMergeBarrier).toHaveBeenCalledWith(lease);
  });

  it('does not retry a failed merge page inside the same claim loop', async () => {
    const first = {
      id: 'run-page-ms-1',
      sourcePageId: 'ms-page-1',
      expectedSourceVersion: 'v1',
      expectedSourceContentHash: 'sha256:ms-page-1',
      targetEffectiveKnowledgeHash: null,
      createdAt: new Date(0),
      images: [],
    };
    const lease = mergeLeaseFixture();
    const executionRepo = createExecutionRepo(lease, []);
    executionRepo.claimNextMergePage = jest
      .fn()
      .mockResolvedValueOnce([first])
      .mockResolvedValue([]);
    executionRepo.advanceMergeBarrier = jest
      .fn()
      .mockResolvedValue({ barrierComplete: true });
    let attempts = 0;
    executionRepo.findPendingMergePages = jest.fn().mockResolvedValue([]);
    const pageCompilation = {
      mergePageImages: jest.fn(async (input) => {
        attempts += 1;
        await input.execution.completePage({
          status: 'failed',
          retryable: true,
        });
        return {
          outcome: 'failed',
          retryable: true,
          cause: new Error('provider unavailable'),
        };
      }),
    };
    const runner = new KnowledgeSpaceRunnerService(
      executionRepo as never,
      { initializeLeasedRun: jest.fn() } as never,
      pageCompilation as never,
      finalizer() as never,
      { getKnowledgePageDeadlineMs: () => 900_000 } as never,
    );

    await expect(
      runner.runImageMergeLease(mergeLeaseInput(), {
        workerId: 'worker-1',
        settings: settings(),
        monotonicNow: () => 0,
      }),
    ).resolves.toEqual({ outcome: 'completed', completedPages: 1 });
    expect(pageCompilation.mergePageImages).toHaveBeenCalledTimes(1);
    expect(executionRepo.failMergePage).toHaveBeenCalledWith(
      lease,
      expect.objectContaining({ retryable: true }),
    );
  });
});

function createExecutionRepo(
  lease: ReturnType<typeof leaseFixture> | ReturnType<typeof mergeLeaseFixture>,
  pages: unknown[],
) {
  const firstPage = pages[0];
  return {
    claimSpaceLease: jest.fn().mockResolvedValue(lease),
    findLeasedRun: jest.fn().mockResolvedValue({
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
      failedPageCount: 0,
    }),
    findPendingTextPages: jest.fn().mockResolvedValue(pages),
    findPendingMergePages: jest.fn().mockResolvedValue([]),
    claimNextTextPage: jest.fn().mockResolvedValue(firstPage),
    claimNextMergePage: jest.fn().mockResolvedValue([]),
    isLeaseActive: jest.fn().mockResolvedValue(true),
    isLeaseActiveForPublication: jest.fn().mockResolvedValue(true),
    isLeaseActiveForMergePublication: jest.fn().mockResolvedValue(true),
    completeMergePagePublicationInTransaction: jest
      .fn()
      .mockResolvedValue(true),
    skipMergePage: jest.fn().mockResolvedValue({}),
    failMergePage: jest.fn().mockResolvedValue({}),
    completeTextPage: jest.fn().mockResolvedValue({ barrierComplete: false }),
    heartbeatSpaceLease: jest.fn().mockResolvedValue(true),
    yieldSpaceLease: jest.fn().mockResolvedValue(true),
    advanceTextBarrier: jest
      .fn()
      .mockResolvedValue({ barrierComplete: true, imagesRequired: false }),
    hasImageWork: jest.fn().mockResolvedValue(false),
    completeInitialAggregate: jest.fn().mockResolvedValue({}),
    advanceMergeBarrier: jest.fn().mockResolvedValue({ barrierComplete: true }),
    hasPartialOutcome: jest.fn().mockResolvedValue(false),
    finishRun: jest.fn().mockResolvedValue({ run: { status: 'succeeded' } }),
  };
}

function mergeLeaseInput() {
  return {
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
    spaceRunId: 'run-1',
    knowledgeGeneration: 0,
    phase: 'image_merge' as const,
    spaceJobSequence: 2,
    spaceJobId: 'knowledge-space-image-merge__run-1__image_merge__2',
  };
}

function leaseInput() {
  return {
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
    spaceRunId: 'run-1',
    knowledgeGeneration: 0,
    phase: 'text' as const,
    spaceJobSequence: 1,
    spaceJobId: 'knowledge-space-text__run-1__text__1',
  };
}

function leaseFixture() {
  return {
    runId: 'run-1',
    knowledgeGeneration: 0,
    jobPhase: 'text' as const,
    spaceJobSequence: 1,
    spaceJobId: 'knowledge-space-text__run-1__text__1',
    executionToken: 'token-1',
  };
}

function mergeLeaseFixture() {
  return {
    runId: 'run-1',
    knowledgeGeneration: 0,
    jobPhase: 'image_merge' as const,
    spaceJobSequence: 2,
    spaceJobId: 'knowledge-space-image-merge__run-1__image_merge__2',
    executionToken: 'token-2',
  };
}

function settings() {
  return {
    maxPages: 5,
    maxMs: 300_000,
    heartbeatMs: 30_000,
    leaseTtlMs: 180_000,
  };
}

function finalizer() {
  return {
    finalizeLeased: jest.fn().mockResolvedValue({
      outcome: 'completed',
      resolvedCanonicalLinkCount: 0,
    }),
  };
}

function pageResult() {
  return {
    type: 'text' as const,
    status: 'succeeded' as const,
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
    compilerRunId: 'compile-1',
    sourceCount: 1,
    importedArtifactCount: 1,
    quarantinedArtifactCount: 0,
    durationMs: 1,
  };
}
