import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('analytics_events')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('event', 'varchar(32)', (col) => col.notNull())
    .addColumn('route', 'varchar(64)')
    // No FKs: space_deleted outlives its space, pages may be hard-deleted.
    .addColumn('space_id', 'uuid')
    .addColumn('page_id', 'uuid')
    .addColumn('metadata', 'jsonb')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .execute();

  await db.schema
    .createIndex('idx_analytics_events_ws_event_created')
    .on('analytics_events')
    .columns(['workspace_id', 'event', 'created_at'])
    .execute();

  await sql`
    CREATE INDEX idx_analytics_events_page_view_space
    ON analytics_events (workspace_id, space_id, created_at)
    WHERE event = 'page_view'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('analytics_events').execute();
}
