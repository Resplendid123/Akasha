import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Kysely, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as postgres from 'postgres';
import { normalizePostgresUrl } from '../common/helpers';
import {
  down,
  up,
} from './migrations/20260923T100000-knowledge-run-follow-up-scope';

describe('knowledge Run follow-up scope migration', () => {
  it('separates and backfills the follow-up scope', async () => {
    const source = await readFile(
      resolve(
        __dirname,
        'migrations/20260923T100000-knowledge-run-follow-up-scope.ts',
      ),
      'utf8',
    );

    expect(source).toContain(
      ".addColumn('follow_up_target_source_page_ids', 'jsonb')",
    );
    expect(source).toContain(
      'SET follow_up_target_source_page_ids = target_source_page_ids',
    );
    expect(source).toContain('WHERE rerun_requested = true');
    expect(source).toContain(
      'SET target_source_page_ids = follow_up_target_source_page_ids',
    );
    expect(source).toContain(".dropColumn('follow_up_target_source_page_ids')");
  });
});

const integrationDatabaseUrl =
  process.env.AKASHA_MIGRATION_TEST_DATABASE_URL?.trim();
const describePostgres = integrationDatabaseUrl ? describe : describe.skip;

describePostgres('knowledge Run follow-up scope PostgreSQL round trip', () => {
  const schema = `akasha_follow_up_scope_${process.pid}_${Date.now()}`;
  let client: ReturnType<typeof postgres>;
  let db: Kysely<unknown>;

  beforeAll(async () => {
    client = postgres(normalizePostgresUrl(integrationDatabaseUrl!), {
      max: 1,
      onnotice: () => {},
    });
    db = new Kysely({ dialect: new PostgresJSDialect({ postgres: client }) });
    await sql.raw(`create schema "${schema}"`).execute(db);
    await sql.raw(`set search_path to "${schema}"`).execute(db);
    await sql`
      create table knowledge_space_compile_runs (
        id varchar primary key,
        target_source_page_ids jsonb,
        rerun_requested boolean not null default false
      );
      insert into knowledge_space_compile_runs (
        id, target_source_page_ids, rerun_requested
      ) values
        ('rerun', '["page-a"]'::jsonb, true),
        ('settled', '["page-b"]'::jsonb, false)
    `.execute(db);
  });

  afterAll(async () => {
    if (!db) return;
    await sql.raw(`drop schema if exists "${schema}" cascade`).execute(db);
    await db.destroy();
  });

  it('preserves pending follow-up intent across up and down', async () => {
    await up(db);
    const migrated = await sql<{
      id: string;
      followUpTargetSourcePageIds: string[] | null;
    }>`
      select id,
             follow_up_target_source_page_ids as "followUpTargetSourcePageIds"
      from knowledge_space_compile_runs
      order by id
    `.execute(db);
    expect(migrated.rows).toEqual([
      { id: 'rerun', followUpTargetSourcePageIds: ['page-a'] },
      { id: 'settled', followUpTargetSourcePageIds: null },
    ]);

    await sql`
      update knowledge_space_compile_runs
      set follow_up_target_source_page_ids = '["page-c"]'::jsonb
      where id = 'rerun'
    `.execute(db);
    await down(db);
    const rolledBack = await sql<{
      id: string;
      targetSourcePageIds: string[] | null;
    }>`
      select id, target_source_page_ids as "targetSourcePageIds"
      from knowledge_space_compile_runs
      order by id
    `.execute(db);
    expect(rolledBack.rows).toEqual([
      { id: 'rerun', targetSourcePageIds: ['page-c'] },
      { id: 'settled', targetSourcePageIds: ['page-b'] },
    ]);
  });
});
