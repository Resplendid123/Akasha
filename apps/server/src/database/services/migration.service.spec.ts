import { Kysely, PostgresDialect } from 'kysely';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { MigrationService } from './migration.service';

describe('MigrationService statement timeout', () => {
  it('pins migrations to one connection and restores the online timeout', async () => {
    const connectionDb = {};
    const db = {
      connection: () => ({
        execute: (callback: (connection: unknown) => Promise<unknown>) =>
          callback(connectionDb),
      }),
    };
    const environment = {
      getDatabaseStatementTimeoutMs: () => 30_000,
    };
    const migrateToLatest = jest.fn().mockResolvedValue({
      error: undefined,
      results: [],
    });
    const service = new TestMigrationService(
      db as never,
      environment as unknown as EnvironmentService,
      migrateToLatest,
    );

    await service.migrateToLatest();

    expect(migrateToLatest).toHaveBeenCalledTimes(1);
    expect(service.migratorDb).toBe(connectionDb);
    expect(service.statementTimeouts).toEqual([900_000, 30_000]);
  });
});

describe('squashed baseline adoption', () => {
  const onDisk = [
    '20261021T000000-baseline-v1',
    '20261021T100000-finalize-knowledge-relations',
    '20261021T110000-knowledge-graph-nodes',
    '20261021T130000-simplify-knowledge-links',
  ];

  async function adopt(input: { ledger?: string[]; baselineFails?: boolean }) {
    const statements: string[] = [];
    const db = fakeLedgerDb(input.ledger, statements);
    const baselineUp = jest.fn(async () => {
      if (input.baselineFails) throw new Error('column "slug_id" does not exist');
    });
    const service = new LedgerMigrationService(db as never, onDisk, baselineUp);
    let threw = false;
    try {
      await service.adopt(db as never);
    } catch {
      threw = true;
    }
    return {
      threw,
      baselineRan: baselineUp.mock.calls.length,
      deleted: statements.some((it) => it.includes('DELETE FROM kysely_migration')),
      backedUp: statements.some((it) =>
        it.includes('INSERT INTO kysely_migration_superseded'),
      ),
      wroteBaselineRow: statements.some((it) =>
        it.includes('INSERT INTO kysely_migration (name, timestamp)'),
      ),
    };
  }

  const legacy110 = Array.from({ length: 110 }, (_, i) => `legacy-${i}`);

  it('adopts the baseline and retains the superseded rows once it applies cleanly', async () => {
    expect(await adopt({ ledger: legacy110 })).toEqual({
      threw: false,
      baselineRan: 1,
      deleted: true,
      backedUp: true,
      wroteBaselineRow: true,
    });
  });

  it('keeps the ledger intact when the baseline cannot match the schema', async () => {
    const result = await adopt({ ledger: legacy110, baselineFails: true });
    expect(result.threw).toBe(true);
    expect(result.baselineRan).toBe(1);
    expect(result.deleted).toBe(false);
    expect(result.backedUp).toBe(false);
  });

  it('leaves an already-adopted ledger untouched', async () => {
    const result = await adopt({ ledger: onDisk });
    expect(result.baselineRan).toBe(0);
    expect(result.deleted).toBe(false);
  });

  it('leaves a fresh database untouched', async () => {
    for (const ledger of [[], undefined]) {
      const result = await adopt({ ledger });
      expect(result.baselineRan).toBe(0);
      expect(result.deleted).toBe(false);
    }
  });

  it('refuses to touch a ledger where superseded and current rows coexist', async () => {
    const result = await adopt({ ledger: ['legacy-000', onDisk[0]] });
    expect(result.baselineRan).toBe(0);
    expect(result.deleted).toBe(false);
  });
});

function fakeLedgerDb(ledger: string[] | undefined, statements: string[]) {
  const executor = new Kysely<never>({
    dialect: new PostgresDialect({ pool: {} as never }),
  }).getExecutor();
  (executor as unknown as Record<string, unknown>).executeQuery = async (
    compiled: { sql: string },
  ) => {
    statements.push(compiled.sql);
    if (compiled.sql.includes('to_regclass'))
      return { rows: [{ present: ledger !== undefined }] };
    if (compiled.sql.includes('SELECT name FROM kysely_migration'))
      return { rows: (ledger ?? []).map((name) => ({ name })) };
    return { rows: [] };
  };
  const db = {
    getExecutor: () => executor,
    transaction: () => ({
      execute: async (run: (trx: unknown) => Promise<unknown>) => {
        const trxStatements: string[] = [];
        const result = await run(fakeLedgerDb(ledger, trxStatements));
        statements.push(...trxStatements);
        return result;
      },
    }),
  };
  return db;
}

class LedgerMigrationService extends MigrationService {
  constructor(
    db: ConstructorParameters<typeof MigrationService>[0],
    private readonly names: string[],
    private readonly baselineUp: jest.Mock,
  ) {
    super(db, { getDatabaseStatementTimeoutMs: () => 30_000 } as never);
  }

  async adopt(db: ConstructorParameters<typeof MigrationService>[0]) {
    return this.adoptSquashedBaseline(db);
  }

  protected createMigrator() {
    return {
      getMigrations: async () =>
        this.names.map((name, index) => ({
          name,
          migration: index === 0 ? { up: this.baselineUp } : {},
        })),
    } as never;
  }
}

class TestMigrationService extends MigrationService {
  migratorDb: unknown;
  statementTimeouts: number[] = [];

  constructor(
    db: ConstructorParameters<typeof MigrationService>[0],
    environment: EnvironmentService,
    private readonly migrate: jest.Mock,
  ) {
    super(db, environment);
  }

  protected createMigrator(db: unknown) {
    this.migratorDb = db;
    return { migrateToLatest: this.migrate } as never;
  }

  protected async setStatementTimeout(
    _db: ConstructorParameters<typeof MigrationService>[0],
    timeoutMs: number,
  ): Promise<void> {
    this.statementTimeouts.push(timeoutMs);
  }

  protected async adoptSquashedBaseline(): Promise<void> {}
}
