import { Kysely, Migrator, sql } from 'kysely';

export interface AdoptionLogger {
  log(message: string): void;
  error(message: string): void;
}

/**
 * Databases provisioned before the v1 baseline hold ledger rows for the 110
 * migration files it squashed. Kysely refuses that state outright, so both the
 * CLI and server startup would fail before any migration runs.
 *
 * The baseline is only equivalent to those 110 migrations for a database that
 * actually ran all of them. A database that stopped partway has tables the
 * baseline cannot repair, because the squashed schema only creates missing
 * tables and never adds missing columns. So run the baseline first and give up
 * the old ledger only once it succeeds: one transaction, no proxy signal for
 * completeness, and an untouched ledger whenever the schemas disagree.
 */
export async function adoptSquashedBaseline(input: {
  db: Kysely<any>;
  migrator: Migrator;
  logger: AdoptionLogger;
}): Promise<void> {
  const { db, migrator, logger } = input;
  const ledgerExists = await sql<{ present: boolean }>`
    SELECT to_regclass('public.kysely_migration') IS NOT NULL AS present
  `.execute(db);
  if (!ledgerExists.rows[0]?.present) return;

  const executed = (
    await sql<{ name: string }>`SELECT name FROM kysely_migration`.execute(db)
  ).rows.map((row) => row.name);
  if (executed.length === 0) return;

  const onDisk = await migrator.getMigrations();
  if (executed.some((name) => onDisk.some((it) => it.name === name))) return;

  const baseline = onDisk[0];
  if (!baseline?.migration.up) return;

  logger.log(
    `Adopting the squashed v1 baseline over ${executed.length} superseded ledger rows`,
  );
  try {
    await db.transaction().execute(async (trx) => {
      await baseline.migration.up(trx);
      await sql`CREATE TABLE IF NOT EXISTS kysely_migration_superseded
        (name varchar(255) PRIMARY KEY, timestamp varchar(255) NOT NULL)`.execute(
        trx,
      );
      await sql`INSERT INTO kysely_migration_superseded
        SELECT name, timestamp FROM kysely_migration ON CONFLICT DO NOTHING`.execute(
        trx,
      );
      await sql`DELETE FROM kysely_migration`.execute(trx);
      await sql`INSERT INTO kysely_migration (name, timestamp)
        VALUES (${baseline.name}, ${new Date().toISOString()})`.execute(trx);
    });
  } catch (error) {
    logger.error(
      'The squashed v1 baseline could not be applied, so the migration ledger was left untouched. ' +
        'The error below names the object it tripped on: a constraint error means existing rows ' +
        'violate it and must be reconciled first, while a missing column or relation means this ' +
        'database never ran every superseded migration.',
    );
    throw error;
  }
  logger.log(
    'Baseline adopted; superseded ledger rows retained in kysely_migration_superseded',
  );
}
