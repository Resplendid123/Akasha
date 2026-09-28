import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Kysely, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as postgres from 'postgres';
import { normalizePostgresUrl } from '../common/helpers';
import {
  down,
  up,
} from './migrations/20260923T120000-drop-dead-run-plan-and-prepared-import-columns';

describe('drop dead run plan and prepared import columns migration', () => {
  let source: string;

  beforeAll(async () => {
    source = await readFile(
      resolve(
        __dirname,
        'migrations/20260923T120000-drop-dead-run-plan-and-prepared-import-columns.ts',
      ),
      'utf8',
    );
  });

  it('drops the dead run plan columns from knowledge_space_compile_runs', () => {
    expect(source).toContain("alterTable('knowledge_space_compile_runs')");
    expect(source).toContain(".dropColumn('aggregate_required')");
    expect(source).toContain(".dropColumn('catalog_snapshot')");
    expect(source).toContain(".dropColumn('catalog_hash')");
  });

  it('drops the disabled prepared-import columns from knowledge_compilation_attempts', () => {
    expect(source).toContain("alterTable('knowledge_compilation_attempts')");
    expect(source).toContain(".dropColumn('pending_import')");
    expect(source).toContain(".dropColumn('pending_space_id')");
    expect(source).toContain(".dropColumn('pending_source_version')");
    expect(source).toContain(".dropColumn('pending_effective_knowledge_hash')");
    expect(source).toContain(".dropColumn('pending_created_at')");
  });

  it('restores every dropped column in down()', () => {
    expect(source).toContain("addColumn('aggregate_required'");
    expect(source).toContain("addColumn('catalog_snapshot'");
    expect(source).toContain("addColumn('catalog_hash'");
    expect(source).toContain("addColumn('pending_import'");
    expect(source).toContain("addColumn('pending_space_id'");
    expect(source).toContain("addColumn('pending_source_version'");
    expect(source).toContain("addColumn('pending_effective_knowledge_hash'");
    expect(source).toContain("addColumn('pending_created_at'");
    expect(source).toContain("defaultTo('pending-initialization')");
  });

  it('locks both tables before altering', () => {
    expect(source).toContain(
      'LOCK TABLE knowledge_space_compile_runs IN SHARE ROW EXCLUSIVE MODE',
    );
    expect(source).toContain(
      'LOCK TABLE knowledge_compilation_attempts IN SHARE ROW EXCLUSIVE MODE',
    );
  });
});

const integrationDatabaseUrl =
  process.env.AKASHA_MIGRATION_TEST_DATABASE_URL?.trim();
const describePostgres = integrationDatabaseUrl ? describe : describe.skip;

describePostgres(
  'drop dead run plan and prepared import columns PostgreSQL round trip',
  () => {
    const schema = `akasha_drop_dead_knowledge_${process.pid}_${Date.now()}`;
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
        CREATE TABLE knowledge_space_compile_runs (
          id varchar PRIMARY KEY,
          aggregate_required boolean NOT NULL DEFAULT false,
          catalog_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
          catalog_hash varchar NOT NULL
        );
        INSERT INTO knowledge_space_compile_runs (
          id, aggregate_required, catalog_snapshot, catalog_hash
        ) VALUES ('run-1', false, '[]'::jsonb, 'pending-initialization');

        CREATE TABLE knowledge_compilation_attempts (
          id varchar PRIMARY KEY,
          pending_import jsonb,
          pending_space_id uuid,
          pending_source_version varchar,
          pending_effective_knowledge_hash varchar,
          pending_created_at timestamptz
        );
        INSERT INTO knowledge_compilation_attempts (
          id, pending_import, pending_space_id, pending_source_version,
          pending_effective_knowledge_hash, pending_created_at
        ) VALUES (
          'attempt-1', '{"acceptedArtifacts":[]}'::jsonb,
          '11111111-1111-4111-8111-111111111111', 'v1', 'sha256:effective',
          now()
        )
      `.execute(db);
    });

    afterAll(async () => {
      if (!db) return;
      await sql.raw(`drop schema if exists "${schema}" cascade`).execute(db);
      await db.destroy();
    });

    it('drops the columns and rolls back with safe values for existing rows', async () => {
      await db.transaction().execute((trx) => up(trx));

      const afterUp = await removedColumnCount(db);
      expect(afterUp).toBe(0);

      await db.transaction().execute((trx) => down(trx));

      const run = await sql<{
        aggregateRequired: boolean;
        catalogSnapshot: unknown[];
        catalogHash: string;
      }>`
        SELECT
          aggregate_required AS "aggregateRequired",
          catalog_snapshot AS "catalogSnapshot",
          catalog_hash AS "catalogHash"
        FROM knowledge_space_compile_runs
        WHERE id = 'run-1'
      `.execute(db);
      expect(run.rows).toEqual([
        {
          aggregateRequired: true,
          catalogSnapshot: [],
          catalogHash: 'pending-initialization',
        },
      ]);

      const attempt = await sql<{
        pendingImport: unknown;
        pendingSpaceId: string | null;
        pendingSourceVersion: string | null;
        pendingEffectiveKnowledgeHash: string | null;
        pendingCreatedAt: Date | null;
      }>`
        SELECT
          pending_import AS "pendingImport",
          pending_space_id AS "pendingSpaceId",
          pending_source_version AS "pendingSourceVersion",
          pending_effective_knowledge_hash AS "pendingEffectiveKnowledgeHash",
          pending_created_at AS "pendingCreatedAt"
        FROM knowledge_compilation_attempts
        WHERE id = 'attempt-1'
      `.execute(db);
      expect(attempt.rows).toEqual([
        {
          pendingImport: null,
          pendingSpaceId: null,
          pendingSourceVersion: null,
          pendingEffectiveKnowledgeHash: null,
          pendingCreatedAt: null,
        },
      ]);
    });
  },
);

async function removedColumnCount(db: Kysely<unknown>): Promise<number> {
  const result = await sql<{ count: number }>`
    SELECT count(*)::integer AS count
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND (
        (
          table_name = 'knowledge_space_compile_runs'
          AND column_name IN (
            'aggregate_required', 'catalog_snapshot', 'catalog_hash'
          )
        )
        OR (
          table_name = 'knowledge_compilation_attempts'
          AND column_name IN (
            'pending_import', 'pending_space_id', 'pending_source_version',
            'pending_effective_knowledge_hash', 'pending_created_at'
          )
        )
      )
  `.execute(db);
  return result.rows[0]?.count ?? -1;
}
