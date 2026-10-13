/** Default matches the `db` service published by docker-compose.dev.yml with .env.example credentials. */
const DEFAULT_TEST_DATABASE_URL =
  "postgres://task_tracker:change-me@localhost:5432/task_tracker_test";

export const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;

/** Name of the database in `url`; integration tests truncate it, so it must end in "_test". */
export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}
