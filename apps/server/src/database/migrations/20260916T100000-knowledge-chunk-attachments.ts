import { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('knowledge_chunk_attachments')
    .addColumn('workspace_id', 'uuid', (col) => col.notNull())
    .addColumn('chunk_id', 'uuid', (col) =>
      col.notNull().references('knowledge_chunks.id').onDelete('cascade'),
    )
    .addColumn('occurrence_order', 'integer', (col) => col.notNull())
    .addColumn('attachment_id', 'uuid', (col) => col.notNull())
    .addColumn('source_page_id', 'uuid', (col) => col.notNull())
    .addColumn('source_version', 'text', (col) => col.notNull())
    .addColumn('source_content_hash', 'text', (col) => col.notNull())
    .addColumn('attachment_updated_at', 'timestamptz', (col) => col.notNull())
    .addPrimaryKeyConstraint('knowledge_chunk_attachments_pkey', [
      'chunk_id',
      'occurrence_order',
    ])
    .execute();

  await db.schema
    .createIndex('idx_knowledge_chunk_attachments_workspace_chunk')
    .on('knowledge_chunk_attachments')
    .columns(['workspace_id', 'chunk_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropTable('knowledge_chunk_attachments')
    .ifExists()
    .execute();
}
