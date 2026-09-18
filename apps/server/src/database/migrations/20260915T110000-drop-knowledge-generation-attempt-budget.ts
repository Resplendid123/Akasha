import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE knowledge_compilation_attempts
      DROP CONSTRAINT IF EXISTS
        chk_knowledge_compilation_attempts_generation_count
  `.execute(db);
  await db.schema
    .alterTable('knowledge_compilation_attempts')
    .dropColumn('generation_attempt_count')
    .dropColumn('generation_attempt_source_hash')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('knowledge_compilation_attempts')
    .addColumn('generation_attempt_source_hash', 'varchar')
    .addColumn('generation_attempt_count', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .execute();
  await sql`
    ALTER TABLE knowledge_compilation_attempts
      ADD CONSTRAINT chk_knowledge_compilation_attempts_generation_count
        CHECK (generation_attempt_count BETWEEN 0 AND 3)
  `.execute(db);
}
