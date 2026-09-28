import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // The replacement model intentionally does not migrate legacy public keys.
  // Deleting them first also cascades their api_key_spaces rows.
  await sql`DELETE FROM api_keys WHERE key_type = 'public_retrieval'`.execute(db);

  await db.schema
    .alterTable('users')
    .addColumn('user_type', 'varchar', (col) =>
      col.notNull().defaultTo('normal'),
    )
    .execute();

  await sql`
    ALTER TABLE users
    ADD CONSTRAINT users_user_type_check
    CHECK (user_type IN ('normal', 'agent'))
  `.execute(db);

  await db.schema
    .alterTable('api_keys')
    .dropConstraint('api_keys_key_type_check')
    .execute();

  await db.schema
    .alterTable('api_keys')
    .addColumn('agent_user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('restrict'),
    )
    .addColumn('credential_version', 'bigint')
    .execute();

  await sql`
    ALTER TABLE api_keys
    ADD CONSTRAINT api_keys_key_type_check
    CHECK (key_type IN ('personal', 'agent'))
  `.execute(db);

  await sql`
    ALTER TABLE api_keys
    ADD CONSTRAINT api_keys_agent_fields_check
    CHECK (
      (key_type = 'personal'
        AND agent_user_id IS NULL
        AND credential_version IS NULL)
      OR
      (key_type = 'agent'
        AND agent_user_id IS NOT NULL
        AND credential_version IS NOT NULL
        AND expires_at IS NULL)
    )
  `.execute(db);

  await db.schema
    .createIndex('idx_api_keys_agent_user_id_unique')
    .unique()
    .on('api_keys')
    .column('agent_user_id')
    .where('agent_user_id', 'is not', null)
    .execute();

  await sql`
    CREATE UNIQUE INDEX idx_api_keys_active_agent_name_unique
    ON api_keys (workspace_id, lower(btrim(name)))
    WHERE key_type = 'agent' AND deleted_at IS NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Production rollback requires restoring the pre-migration database backup.
  // This down migration only restores the old schema shape for local development.
  await sql`DELETE FROM api_keys WHERE key_type = 'agent'`.execute(db);

  await db.schema
    .dropIndex('idx_api_keys_active_agent_name_unique')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('idx_api_keys_agent_user_id_unique')
    .ifExists()
    .execute();
  await db.schema
    .alterTable('api_keys')
    .dropConstraint('api_keys_agent_fields_check')
    .execute();
  await db.schema
    .alterTable('api_keys')
    .dropConstraint('api_keys_key_type_check')
    .execute();
  await db.schema
    .alterTable('api_keys')
    .dropColumn('credential_version')
    .dropColumn('agent_user_id')
    .execute();
  await sql`
    ALTER TABLE api_keys
    ADD CONSTRAINT api_keys_key_type_check
    CHECK (key_type IN ('personal', 'public_retrieval'))
  `.execute(db);

  await db.schema
    .alterTable('users')
    .dropConstraint('users_user_type_check')
    .execute();
  await db.schema.alterTable('users').dropColumn('user_type').execute();
}
