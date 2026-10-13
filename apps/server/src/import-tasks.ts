/**
 * Bulk-imports tasks from a JSON file into a project. Locally:
 * `pnpm --filter @task-tracker/server import:tasks --project <slug> [--dry-run] <file.json>`;
 * inside the production container: `node dist/import-tasks.js --project <slug> [--dry-run] <file.json | ->`.
 */
import { readFile } from "node:fs/promises";
import { text } from "node:stream/consumers";
import { createDb } from "./db/client.ts";
import { runImportTasksCli } from "./import-tasks-cli.ts";
import { createNotificationPublisher } from "./infrastructure/create-notification-publisher.ts";
import { createDrizzleTaskStore } from "./infrastructure/drizzle-task-store.ts";

/** Gives the summary notification a few seconds to go out. */
const FLUSH_TIMEOUT_MS = 10_000;

try {
  process.exitCode = await runImportTasksCli(process.argv.slice(2), {
    env: process.env,
    readFile: (path) => readFile(path, "utf8"),
    readStdin: () => text(process.stdin),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    openStore: (databaseUrl) => {
      const { sql, db } = createDb(databaseUrl);
      return { store: createDrizzleTaskStore(db), close: () => sql.end({ timeout: 5 }) };
    },
    createPublisher: (options) => {
      const publisher = createNotificationPublisher({ ...options, info: () => {} });
      const timeout = () => new Promise<void>((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS).unref());
      return { ...publisher, flush: () => Promise.race([publisher.flush(), timeout()]) };
    },
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
