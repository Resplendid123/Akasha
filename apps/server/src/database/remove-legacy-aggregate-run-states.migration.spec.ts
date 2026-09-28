import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('remove legacy aggregate run states migration', () => {
  let source: string;

  beforeAll(async () => {
    source = await readFile(
      resolve(
        __dirname,
        'migrations/20260923T110000-remove-legacy-aggregate-run-states.ts',
      ),
      'utf8',
    );
  });

  it('refuses to guess recovery for active legacy Runs', () => {
    expect(source).toContain("status = 'aggregate_pending'");
    expect(source).toContain(
      "phase IN ('initial_aggregate', 'final_aggregate')",
    );
    expect(source).toContain(
      "status IN ('queued', 'compiling', 'aggregating')",
    );
    expect(source).toContain('RAISE EXCEPTION');
  });

  it('normalizes terminal history and contracts the checks and active index', () => {
    expect(source).toContain("SET phase = 'text'");
    expect(source).toContain("WHERE phase = 'initial_aggregate'");
    expect(source).toContain("SET phase = 'finalizing'");
    expect(source).toContain("WHERE phase = 'final_aggregate'");
    expect(source).toContain(
      "'text', 'images', 'image_merge', 'finalizing', 'complete'",
    );
    expect(source).toContain(
      "WHERE status IN ('queued', 'compiling', 'aggregating')",
    );
  });
});
