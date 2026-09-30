import { randomUUID } from 'node:crypto';
import { Kysely, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as postgres from 'postgres';
import { normalizePostgresUrl } from '../common/helpers';
import {
  down,
  up,
} from './migrations/20260930T130000-knowledge-page-merge-pipeline';

const databaseUrl = process.env.AKASHA_MIGRATION_TEST_DATABASE_URL?.trim();
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres('page-level Merge pipeline PostgreSQL migration', () => {
  const schema = `akasha_merge_migration_${randomUUID().replaceAll('-', '')}`;
  let db: Kysely<unknown>;

  beforeAll(async () => {
    const client = postgres(normalizePostgresUrl(databaseUrl!), {
      max: 1,
      connection: { search_path: schema },
      onnotice: () => {},
    });
    db = new Kysely({ dialect: new PostgresJSDialect({ postgres: client }) });
    await sql.raw(`create schema "${schema}"`).execute(db);
  });

  beforeEach(async () => {
    await sql`
      drop table if exists knowledge_space_compile_run_pages;
      drop table if exists knowledge_space_compile_runs;
      create table knowledge_space_compile_runs (
        id varchar primary key, status varchar not null
      );
      create table knowledge_space_compile_run_pages (
        id varchar primary key,
        run_id varchar not null,
        merge_status varchar not null,
        merge_job_id varchar,
        merge_attempt_count integer not null default 0,
        merged_effective_knowledge_hash varchar,
        updated_at timestamptz not null default now()
      );
      insert into knowledge_space_compile_runs values ('run-1', 'succeeded');
      insert into knowledge_space_compile_run_pages (
        id, run_id, merge_status, merge_job_id, merged_effective_knowledge_hash
      ) values ('page-a', 'run-1', 'succeeded', 'legacy-job', 'legacy-hash'),
               ('page-b', 'run-1', 'succeeded', null, 'other-hash');
    `.execute(db);
  });

  afterAll(async () => {
    if (!db) return;
    await sql.raw(`drop schema if exists "${schema}" cascade`).execute(db);
    await db.destroy();
  });

  it.each(['queued', 'compiling', 'aggregate_pending', 'aggregating'])(
    'refuses cutover with an active %s Run before changing the schema',
    async (status) => {
      await sql`update knowledge_space_compile_runs set status = ${status}`.execute(
        db,
      );
      await expect(db.transaction().execute(up)).rejects.toThrow(
        '1 active run(s)',
      );
      expect(await mergeColumnCount()).toBe(0);
      expect(
        (
          await sql`select count(*)::int n from knowledge_space_compile_run_pages`.execute(
            db,
          )
        ).rows,
      ).toEqual([{ n: 2 }]);
    },
  );

  it('round-trips up/down/up without changing historical Merge results', async () => {
    await db.transaction().execute(up);
    expect(await mergeColumnCount()).toBe(7);
    const state = await sql`
      select merge_status, merge_job_id, merge_attempt_count,
             merged_effective_knowledge_hash, merge_redis_recovery_count,
             merge_execution_token, merge_failure_class
      from knowledge_space_compile_run_pages where id = 'page-a'
    `.execute(db);
    expect(state.rows).toEqual([
      {
        merge_status: 'succeeded',
        merge_job_id: 'legacy-job',
        merge_attempt_count: 0,
        merged_effective_knowledge_hash: 'legacy-hash',
        merge_redis_recovery_count: 0,
        merge_execution_token: null,
        merge_failure_class: null,
      },
    ]);
    expect(
      (
        await sql`
      select count(*)::int n from pg_indexes
      where schemaname = ${schema} and indexname in (
        'uq_knowledge_run_pages_merge_job_id',
        'uq_knowledge_run_pages_one_outstanding_merge',
        'idx_knowledge_run_pages_merge_dispatch'
      )
    `.execute(db)
      ).rows,
    ).toEqual([{ n: 3 }]);
    await db.transaction().execute(down);
    expect(await mergeColumnCount()).toBe(0);
    await db.transaction().execute(up);
    expect(await mergeColumnCount()).toBe(7);
    expect(
      (
        await sql`select merged_effective_knowledge_hash from knowledge_space_compile_run_pages where id = 'page-a'`.execute(
          db,
        )
      ).rows,
    ).toEqual([{ merged_effective_knowledge_hash: 'legacy-hash' }]);
  });

  it('enforces unique Job identity and one outstanding Merge per Run', async () => {
    await db.transaction().execute(up);
    await expect(
      sql`update knowledge_space_compile_run_pages set merge_job_id = 'legacy-job' where id = 'page-b'`.execute(
        db,
      ),
    ).rejects.toThrow('uq_knowledge_run_pages_merge_job_id');
    await sql`update knowledge_space_compile_run_pages set merge_status = 'queued' where id = 'page-a'`.execute(
      db,
    );
    await expect(
      sql`update knowledge_space_compile_run_pages set merge_status = 'running' where id = 'page-b'`.execute(
        db,
      ),
    ).rejects.toThrow('uq_knowledge_run_pages_one_outstanding_merge');
    await sql`update knowledge_space_compile_run_pages set merge_status = 'failed' where id = 'page-a'`.execute(
      db,
    );
    await sql`update knowledge_space_compile_run_pages set merge_status = 'running' where id = 'page-b'`.execute(
      db,
    );
  });

  it('rejects invalid transport recovery counters and failure classes', async () => {
    await db.transaction().execute(up);
    for (const count of [-1, 4]) {
      await expect(
        sql`update knowledge_space_compile_run_pages set merge_redis_recovery_count = ${count} where id = 'page-a'`.execute(
          db,
        ),
      ).rejects.toThrow('chk_knowledge_run_pages_merge_redis_recovery_count');
    }
    await expect(
      sql`update knowledge_space_compile_run_pages set merge_failure_class = 'partial_image' where id = 'page-a'`.execute(
        db,
      ),
    ).rejects.toThrow('chk_knowledge_run_pages_merge_failure_class');
    for (const value of ['permanent', 'retryable_exhausted', null]) {
      await sql`update knowledge_space_compile_run_pages set merge_failure_class = ${value} where id = 'page-a'`.execute(
        db,
      );
    }
  });

  async function mergeColumnCount(): Promise<number> {
    const result = await sql<{ n: number }>`
      select count(*)::int n from information_schema.columns
      where table_schema = ${schema}
        and table_name = 'knowledge_space_compile_run_pages'
        and column_name in ('merge_dispatched_at', 'merge_processing_expires_at',
          'merge_redis_recovery_count', 'merge_failure_class', 'merge_execution_token',
          'merge_worker_id', 'merge_heartbeat_at')
    `.execute(db);
    return result.rows[0].n;
  }
});
