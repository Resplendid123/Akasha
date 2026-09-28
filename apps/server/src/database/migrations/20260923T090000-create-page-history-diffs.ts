import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('page_history')
    .addColumn('previous_history_id', 'uuid', (col) =>
      col.references('page_history.id').onDelete('set null'),
    )
    .addColumn('diff_algorithm_version', 'varchar')
    .addColumn('diff_schema_version', 'varchar')
    .addColumn('diff_from_content_hash', 'varchar')
    .addColumn('diff_to_content_hash', 'varchar')
    .addColumn('diff_status', 'varchar')
    .addColumn('diff_changes', 'jsonb')
    .addColumn('diff_added_count', 'int4', (col) => col.notNull().defaultTo(0))
    .addColumn('diff_deleted_count', 'int4', (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('diff_error_code', 'varchar')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('page_history')
    .dropColumn('diff_error_code')
    .dropColumn('diff_deleted_count')
    .dropColumn('diff_added_count')
    .dropColumn('diff_changes')
    .dropColumn('diff_status')
    .dropColumn('diff_to_content_hash')
    .dropColumn('diff_from_content_hash')
    .dropColumn('diff_schema_version')
    .dropColumn('diff_algorithm_version')
    .dropColumn('previous_history_id')
    .execute();
}
