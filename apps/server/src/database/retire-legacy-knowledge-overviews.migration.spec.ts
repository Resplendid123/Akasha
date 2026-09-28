import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Kysely, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as postgres from 'postgres';
import { normalizePostgresUrl } from '../common/helpers';
import {
  down,
  up,
} from './migrations/20260923T130000-retire-legacy-knowledge-overviews';

describe('legacy knowledge overview retirement migration', () => {
  let source: string;

  beforeAll(async () => {
    source = await readFile(
      resolve(
        __dirname,
        'migrations/20260923T130000-retire-legacy-knowledge-overviews.ts',
      ),
      'utf8',
    );
  });

  it('retires legacy pages and every directly retrievable child kind', () => {
    expect(source).toContain("compile_scope = 'space'");
    expect(source).toContain("page_type = 'overview'");
    expect(source).toContain("canonical_key = 'overview'");
    expect(source).toContain(
      "['knowledge_parent_sections', 'knowledge_page_id']",
    );
    expect(source).toContain("['knowledge_claims', 'knowledge_page_id']");
    expect(source).toContain("['knowledge_chunks', 'knowledge_page_id']");
    expect(source).toContain("['knowledge_links', 'from_knowledge_page_id']");
    expect(source).toContain(
      "['knowledge_graph_edges', 'from_knowledge_page_id']",
    );
  });

  it('proves the active legacy set is empty and prevents reactivation', () => {
    expect(source).toContain(
      'Active legacy knowledge overview survived retirement',
    );
    expect(source).toContain('chk_knowledge_pages_active_page_publication');
    expect(source).toContain("compile_scope = 'page'");
    expect(source).toContain("page_type IS DISTINCT FROM 'overview'");
    expect(source).toContain('Retirement is intentionally one-way');
  });
});

const integrationDatabaseUrl =
  process.env.AKASHA_MIGRATION_TEST_DATABASE_URL?.trim();
const describePostgres = integrationDatabaseUrl ? describe : describe.skip;

describePostgres(
  'legacy knowledge overview retirement PostgreSQL round trip',
  () => {
    const schema = `akasha_retire_overviews_${process.pid}_${Date.now()}`;
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
        CREATE TABLE knowledge_pages (
          id varchar PRIMARY KEY,
          compile_scope varchar NOT NULL,
          page_type varchar,
          canonical_key varchar,
          stale_at timestamptz,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE knowledge_parent_sections (
          id varchar PRIMARY KEY,
          knowledge_page_id varchar NOT NULL,
          stale_at timestamptz
        );
        CREATE TABLE knowledge_claims (
          id varchar PRIMARY KEY,
          knowledge_page_id varchar NOT NULL,
          stale_at timestamptz
        );
        CREATE TABLE knowledge_chunks (
          id varchar PRIMARY KEY,
          knowledge_page_id varchar NOT NULL,
          stale_at timestamptz
        );
        CREATE TABLE knowledge_links (
          id varchar PRIMARY KEY,
          from_knowledge_page_id varchar NOT NULL,
          stale_at timestamptz
        );
        CREATE TABLE knowledge_graph_edges (
          id varchar PRIMARY KEY,
          from_knowledge_page_id varchar NOT NULL,
          stale_at timestamptz
        );

        INSERT INTO knowledge_pages (
          id, compile_scope, page_type, canonical_key
        ) VALUES
          ('legacy-space', 'space', 'concept', 'legacy-concept'),
          ('legacy-overview', 'page', 'overview', 'overview');
        INSERT INTO knowledge_parent_sections
          (id, knowledge_page_id) VALUES ('parent-1', 'legacy-overview');
        INSERT INTO knowledge_claims
          (id, knowledge_page_id) VALUES ('claim-1', 'legacy-overview');
        INSERT INTO knowledge_chunks
          (id, knowledge_page_id) VALUES ('chunk-1', 'legacy-overview');
        INSERT INTO knowledge_links
          (id, from_knowledge_page_id) VALUES ('link-1', 'legacy-overview');
        INSERT INTO knowledge_graph_edges
          (id, from_knowledge_page_id) VALUES ('edge-1', 'legacy-overview')
      `.execute(db);
    });

    afterAll(async () => {
      if (!db) return;
      await sql.raw(`drop schema if exists "${schema}" cascade`).execute(db);
      await db.destroy();
    });

    it('retires legacy rows without reserving overview as a canonical key', async () => {
      await db.transaction().execute((trx) => up(trx));

      const legacy = await sql<{ id: string; stale: boolean }>`
        SELECT id, stale_at IS NOT NULL AS stale
        FROM knowledge_pages
        WHERE id IN ('legacy-space', 'legacy-overview')
        ORDER BY id
      `.execute(db);
      expect(legacy.rows).toEqual([
        { id: 'legacy-overview', stale: true },
        { id: 'legacy-space', stale: true },
      ]);

      const staleChildCount = await sql<{ count: number }>`
        SELECT (
          (SELECT count(*) FROM knowledge_parent_sections WHERE stale_at IS NOT NULL)
          + (SELECT count(*) FROM knowledge_claims WHERE stale_at IS NOT NULL)
          + (SELECT count(*) FROM knowledge_chunks WHERE stale_at IS NOT NULL)
          + (SELECT count(*) FROM knowledge_links WHERE stale_at IS NOT NULL)
          + (SELECT count(*) FROM knowledge_graph_edges WHERE stale_at IS NOT NULL)
        )::integer AS count
      `.execute(db);
      expect(staleChildCount.rows).toEqual([{ count: 5 }]);

      await expect(
        sql`
          INSERT INTO knowledge_pages (
            id, compile_scope, page_type, canonical_key
          ) VALUES ('valid-overview-key', 'page', 'concept', 'overview')
        `.execute(db),
      ).resolves.toBeDefined();
      await expect(
        sql`
          INSERT INTO knowledge_pages (
            id, compile_scope, page_type, canonical_key
          ) VALUES ('invalid-overview-kind', 'page', 'overview', 'anything')
        `.execute(db),
      ).rejects.toThrow();

      await db.transaction().execute((trx) => down(trx));
      const afterDown = await sql<{ stale: boolean }>`
        SELECT stale_at IS NOT NULL AS stale
        FROM knowledge_pages
        WHERE id = 'legacy-overview'
      `.execute(db);
      expect(afterDown.rows).toEqual([{ stale: true }]);
    });
  },
);
