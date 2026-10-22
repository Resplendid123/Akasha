import * as path from 'path';
import { promises as fs } from 'fs';
import { Kysely, Migrator, FileMigrationProvider } from 'kysely';
import { run } from 'kysely-migration-cli';
import * as dotenv from 'dotenv';
import { envPath, normalizePostgresUrl } from '../common/helpers';
import { PostgresJSDialect } from 'kysely-postgres-js';
import postgres from 'postgres';
import { buildMigrationPostgresOptions } from './database-postgres-options';
import { adoptSquashedBaseline } from './adopt-squashed-baseline';

dotenv.config({ path: envPath });

const migrationFolder = path.join(__dirname, './migrations');

const db = new Kysely<any>({
  dialect: new PostgresJSDialect({
    postgres: postgres(
      normalizePostgresUrl(process.env.DATABASE_URL),
      buildMigrationPostgresOptions(),
    ),
  }),
});

const migrator = new Migrator({
  db,
  // Merged branches can add migrations older than the last executed migration.
  allowUnorderedMigrations: true,
  provider: new FileMigrationProvider({
    fs,
    path,
    migrationFolder,
  }),
});

adoptSquashedBaseline({
  db,
  migrator,
  logger: {
    log: (message) => console.log(message),
    error: (message) => console.error(message),
  },
})
  .then(() => run(db, migrator, migrationFolder))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
