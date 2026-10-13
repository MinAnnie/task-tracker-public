import postgres from "postgres";
import { runMigrations } from "../../src/db/migrate.ts";
import { databaseName, testDatabaseUrl } from "./database-url.ts";

/**
 * Creates the test database when missing and applies the real migrations to it.
 * Fails loudly (never skips) when Postgres is unreachable.
 */
export default async function setup(): Promise<void> {
  const name = databaseName(testDatabaseUrl);
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to run integration tests against "${name}": TEST_DATABASE_URL must point to a database whose name ends in "_test".`,
    );
  }

  const adminUrl = new URL(testDatabaseUrl);
  adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.toString(), { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    const existing = await admin`select 1 from pg_database where datname = ${name}`;
    if (existing.length === 0) await admin.unsafe(`create database "${name.replaceAll('"', '""')}"`);
  } catch (error) {
    const safeUrl = new URL(testDatabaseUrl);
    safeUrl.password = "***";
    throw new Error(
      `Integration tests need a reachable Postgres at ${safeUrl} (set TEST_DATABASE_URL to override). ` +
        "Start it with: POSTGRES_PASSWORD=change-me " +
        "docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait db",
      { cause: error },
    );
  } finally {
    await admin.end();
  }

  await runMigrations(testDatabaseUrl);
}
