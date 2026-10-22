import { KnowledgeSpaceFinalizerService } from './knowledge-space-finalizer.service';

describe('KnowledgeSpaceFinalizerService', () => {
  const lease = {
    runId: 'r',
    knowledgeGeneration: 1,
    jobPhase: 'text' as const,
    spaceJobSequence: 1,
    spaceJobId: 'j',
    executionToken: 't',
  };
  it.each([true, false])(
    'checks lease without running a relationship resolver (%s)',
    async (active) => {
      const repo = { isLeaseActive: jest.fn().mockResolvedValue(active) };
      const result = await new KnowledgeSpaceFinalizerService(
        repo as never,
      ).finalizeLeased(lease, { workspaceId: 'w', spaceId: 's' });
      expect(result).toEqual({ outcome: active ? 'completed' : 'superseded' });
      expect(repo.isLeaseActive).toHaveBeenCalledWith(lease);
    },
  );
  it('does not finalize when cancelled while checking the lease', async () => {
    const controller = new AbortController();
    const repo = {
      isLeaseActive: jest.fn().mockImplementation(async () => {
        controller.abort();
        return true;
      }),
    };
    await expect(
      new KnowledgeSpaceFinalizerService(repo as never).finalizeLeased(lease, {
        workspaceId: 'w',
        spaceId: 's',
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});
