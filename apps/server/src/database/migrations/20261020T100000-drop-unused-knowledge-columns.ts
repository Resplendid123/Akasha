import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Drop knowledge claims tables and references
  await db.schema
    .dropTable('knowledge_claim_sources')
    .ifExists()
    .execute();

  await db.schema
    .alterTable('knowledge_chunks')
    .dropColumn('claim_id')
    .ifExists()
    .execute();

  await db.schema
    .dropTable('knowledge_claims')
    .ifExists()
    .execute();

  // Drop write-only columns from run pages
  await db.schema
    .alterTable('knowledge_space_compile_run_pages')
    .dropColumn('image_job_id')
    .ifExists()
    .execute();

  // Drop summary from pages (always null)
  await db.schema
    .alterTable('knowledge_pages')
    .dropColumn('summary')
    .ifExists()
    .execute();

  // Drop attachment_id from all sources tables (always null)
  for (const tableName of [
    'knowledge_page_sources',
    'knowledge_parent_section_sources',
    'knowledge_chunk_sources',
    'knowledge_link_sources',
    'knowledge_graph_edge_sources',
  ]) {
    await db.schema
      .alterTable(tableName)
      .dropColumn('attachment_id')
      .ifExists()
      .execute();
  }

  // Drop result_quality from attempts (always 'normal')
  await db.schema
    .alterTable('knowledge_compilation_attempts')
    .dropColumn('result_quality')
    .ifExists()
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  // Recreate knowledge_claims table
  await db.schema
    .createTable('knowledge_claims')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.notNull().references('spaces.id').onDelete('cascade'),
    )
    .addColumn('knowledge_page_id', 'uuid', (col) =>
      col.notNull().references('knowledge_pages.id').onDelete('cascade'),
    )
    .addColumn('text', 'text', (col) => col.notNull())
    .addColumn('confidence', 'float8', (col) => col)
    .addColumn('position', 'integer', (col) => col.notNull())
    .addColumn('compiler_run_id', 'varchar', (col) => col)
    .addColumn('compile_task_id', 'varchar', (col) => col)
    .addColumn('stale_at', 'timestamptz', (col) => col)
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Recreate knowledge_claim_sources table
  await db.schema
    .createTable('knowledge_claim_sources')
    .ifNotExists()
    .addColumn('claim_id', 'uuid', (col) =>
      col.notNull().references('knowledge_claims.id').onDelete('cascade'),
    )
    .addColumn('source_page_id', 'uuid', (col) => col.notNull())
    .addColumn('attachment_id', 'uuid', (col) =>
      col.references('attachments.id').onDelete('cascade'),
    )
    .addColumn('source_version', 'varchar', (col) => col.notNull())
    .addColumn('source_range', 'jsonb', (col) => col)
    .addColumn('quote_hash', 'varchar', (col) => col)
    .addColumn('content_hash', 'varchar', (col) => col.notNull())
    .addColumn('provenance_kind', 'varchar', (col) => col.notNull())
    .execute();

  // Recreate indexes for claim sources
  await db.schema
    .createIndex('idx_knowledge_claim_sources_owner')
    .ifNotExists()
    .on('knowledge_claim_sources')
    .columns(['claim_id', 'source_page_id'])
    .execute();

  await db.schema
    .createIndex('idx_knowledge_claim_sources_source')
    .ifNotExists()
    .on('knowledge_claim_sources')
    .column('source_page_id')
    .execute();

  // Restore claim_id to chunks
  await db.schema
    .alterTable('knowledge_chunks')
    .addColumn('claim_id', 'uuid', (col) =>
      col.references('knowledge_claims.id').onDelete('cascade'),
    )
    .execute();

  // Restore image_job_id
  await db.schema
    .alterTable('knowledge_space_compile_run_pages')
    .addColumn('image_job_id', 'varchar', (col) => col)
    .execute();

  // Restore summary
  await db.schema
    .alterTable('knowledge_pages')
    .addColumn('summary', 'text', (col) => col)
    .execute();

  // Restore attachment_id to all sources tables
  for (const tableName of [
    'knowledge_page_sources',
    'knowledge_parent_section_sources',
    'knowledge_chunk_sources',
    'knowledge_link_sources',
    'knowledge_graph_edge_sources',
  ]) {
    await db.schema
      .alterTable(tableName)
      .addColumn('attachment_id', 'uuid', (col) =>
        col.references('attachments.id').onDelete('cascade'),
      )
      .execute();
  }

  // Restore result_quality with default
  await db.schema
    .alterTable('knowledge_compilation_attempts')
    .addColumn('result_quality', 'varchar', (col) =>
      col.notNull().defaultTo('normal'),
    )
    .execute();
}
