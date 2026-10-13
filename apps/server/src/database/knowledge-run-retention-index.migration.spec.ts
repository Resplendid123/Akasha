import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('knowledge Run retention index migration', () => {
  it('indexes the bounded terminal Run candidate scan', async () => {
    const source = await readFile(
      resolve(
        __dirname,
        'migrations/20261013T110000-knowledge-run-retention-index.ts',
      ),
      'utf8',
    );

    expect(source).toContain(
      'CREATE INDEX IF NOT EXISTS idx_knowledge_space_compile_runs_retention',
    );
    expect(source).toContain('(finished_at, id)');
    expect(source).toContain(
      'INCLUDE (space_id, knowledge_generation, status)',
    );
    expect(source).toContain(
      "status IN ('succeeded', 'partial', 'failed', 'cancelled', 'superseded')",
    );
    expect(source).toContain(
      'DROP INDEX IF EXISTS idx_knowledge_space_compile_runs_retention',
    );
  });
});
