import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('knowledge RunImage extraction index migration', () => {
  it('indexes non-null extraction foreign-key references', async () => {
    const source = await readFile(
      resolve(
        __dirname,
        'migrations/20261013T100000-knowledge-run-image-extraction-index.ts',
      ),
      'utf8',
    );

    expect(source).toContain(
      'CREATE INDEX IF NOT EXISTS idx_knowledge_space_compile_run_images_extraction_id',
    );
    expect(source).toContain(
      'ON knowledge_space_compile_run_images (extraction_id)',
    );
    expect(source).toContain('WHERE extraction_id IS NOT NULL');
    expect(source).toContain(
      'DROP INDEX IF EXISTS idx_knowledge_space_compile_run_images_extraction_id',
    );
  });
});
