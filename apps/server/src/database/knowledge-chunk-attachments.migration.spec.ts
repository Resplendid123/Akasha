import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('knowledge chunk attachments migration', () => {
  it('creates the chunk attachment relation table with expected shape', async () => {
    const source = await readFile(
      resolve(
        __dirname,
        'migrations/20260916T100000-knowledge-chunk-attachments.ts',
      ),
      'utf8',
    );

    expect(source).toContain("createTable('knowledge_chunk_attachments')");
    expect(source).toContain("addColumn('workspace_id', 'uuid'");
    expect(source).toContain("addColumn('chunk_id', 'uuid'");
    expect(source).toContain("addColumn('occurrence_order', 'integer'");
    expect(source).toContain("addColumn('attachment_id', 'uuid'");
    expect(source).toContain("addColumn('source_page_id', 'uuid'");
    expect(source).toContain("addColumn('source_version', 'text'");
    expect(source).toContain("addColumn('source_content_hash', 'text'");
    expect(source).toContain("addColumn('attachment_updated_at', 'timestamptz'");
    expect(source).toContain("references('knowledge_chunks.id').onDelete('cascade')");
    expect(source).toContain(
      "addPrimaryKeyConstraint('knowledge_chunk_attachments_pkey', [",
    );
    expect(source).toContain("'chunk_id'");
    expect(source).toContain("'occurrence_order'");
    expect(source).toContain(
      "createIndex('idx_knowledge_chunk_attachments_workspace_chunk')",
    );
    expect(source).toContain("dropTable('knowledge_chunk_attachments')");
  });
});
