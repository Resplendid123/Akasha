import {
  buildSpaceJobId,
  runPhaseToJobPhase,
  SpaceExecutionLease,
} from './knowledge-space-execution.repo';

describe('knowledge space execution contract', () => {
  it.each([
    ['text', 'text'],
    ['finalizing', 'finalize'],
  ] as const)(
    'maps business phase %s to physical phase %s',
    (phase, jobPhase) => {
      expect(runPhaseToJobPhase(phase)).toBe(jobPhase);
    },
  );

  it('uses deterministic BullMQ-safe slice IDs', () => {
    expect(buildSpaceJobId('run-1', 'text', 3)).toBe(
      'knowledge-space-text__run-1__text__3',
    );
    expect(buildSpaceJobId('run-1', 'finalize', 4)).toBe(
      'knowledge-space-finalize__run-1__finalize__4',
    );
    expect(buildSpaceJobId('run-1', 'text', 3)).not.toContain(':');
  });

  it('never dispatches image or merge business phases onto the Space queue', () => {
    expect(() => runPhaseToJobPhase('images')).toThrow();
    expect(() => runPhaseToJobPhase('image_merge')).toThrow();
  });

  it('requires a complete lease identity at compile time and runtime', () => {
    const lease: SpaceExecutionLease = {
      runId: 'run-1',
      knowledgeGeneration: 2,
      jobPhase: 'text',
      spaceJobSequence: 3,
      spaceJobId: 'job-3',
      executionToken: 'token-3',
    };
    expect(Object.keys(lease).sort()).toEqual([
      'executionToken',
      'jobPhase',
      'knowledgeGeneration',
      'runId',
      'spaceJobId',
      'spaceJobSequence',
    ]);
  });
});
