import { formatImportError, IMPORTED_TASK_STATUSES, importTasks, type ImportPlan } from "./application/import-tasks.ts";
import type { NotificationDispatcher } from "./application/notification-dispatcher.ts";
import type { TaskStore } from "./application/task-store.ts";
import { parseAppBaseUrl } from "./config.ts";

export const IMPORT_USAGE = [
  "Usage: node dist/import-tasks.js --project <slug> [--dry-run] <file.json | ->",
  "  Imports the tasks of a JSON file ({ \"tasks\": [...], \"dependencies\": [...] }) into a project; - reads it from stdin.",
  "  Env: DATABASE_URL (required); DISCORD_BOT_TOKEN and APP_BASE_URL for the summary notification.",
  "  Exit codes: 0 ok, 1 validation errors, 2 usage or configuration errors.",
].join("\n");

export interface ImportCliDeps {
  env: NodeJS.ProcessEnv;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
  out(line: string): void;
  err(line: string): void;
  /** Connects to the database; `close` ends the connection. */
  openStore(databaseUrl: string): { store: TaskStore; close(): Promise<void> };
  /** Notifications are disabled when `discordBotToken` is undefined. */
  createPublisher(options: { discordBotToken: string | undefined; appBaseUrl: string }): NotificationDispatcher;
}

export type ImportArgs = { ok: true; slug: string; dryRun: boolean; source: string } | { ok: false; message: string };

export function parseImportArgs(argv: readonly string[]): ImportArgs {
  let slug: string | undefined;
  let dryRun = false;
  let source: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--project" || arg.startsWith("--project=")) {
      const value = arg === "--project" ? argv[++i] : arg.slice("--project=".length);
      if (slug !== undefined) return { ok: false, message: "--project given twice" };
      if (value === undefined || value === "") return { ok: false, message: "missing --project" };
      slug = value;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--")) {
      return { ok: false, message: `unknown option "${arg}"` };
    } else if (source === undefined) {
      source = arg;
    } else {
      return { ok: false, message: `unexpected argument "${arg}"` };
    }
  }
  if (slug === undefined) return { ok: false, message: "missing --project" };
  if (source === undefined) return { ok: false, message: "missing the JSON file (or - for stdin)" };
  return { ok: true, slug, dryRun, source };
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function describePlan(plan: ImportPlan, dryRun: boolean): string[] {
  const { tasks, explicitKeyCount, dependencyCount, projectSlug, addedDependencies, alreadyPresentDependencyCount } = plan;
  const hasEntries = addedDependencies.length + alreadyPresentDependencyCount > 0;
  const entries = hasEntries
    ? `, ${addedDependencies.length} added dependencies on existing tasks (${alreadyPresentDependencyCount} already present)`
    : "";
  const counts = `${explicitKeyCount} with explicit keys, ${tasks.length - explicitKeyCount} generated, ${dependencyCount} dependencies${entries}`;
  const noun = tasks.length === 1 ? "task" : "tasks";
  const mapping = tasks.flatMap((task) => (task.ref === null ? [] : [`  ${task.key} ← ${task.ref}`]));
  if (!dryRun) return [`Imported ${tasks.length} ${noun} into ${projectSlug} (${counts}).`, ...mapping];
  const statuses = IMPORTED_TASK_STATUSES.flatMap((status) => {
    const count = tasks.filter((task) => task.status === status).length;
    return count === 0 ? [] : [`${count} ${status}`];
  });
  const taskLines =
    tasks.length === 0 ? [] : [`Roots (no dependencies): ${plan.roots.join(", ") || "none"}`, `Statuses: ${statuses.join(", ")}`];
  const edgeLines =
    addedDependencies.length === 0
      ? []
      : [`Added dependencies: ${addedDependencies.map((edge) => `${edge.task} → ${edge.dependsOn}`).join(", ")}`];
  return [
    `Dry run: would import ${tasks.length} ${noun} into ${projectSlug} (${counts}).`,
    ...mapping,
    ...taskLines,
    ...edgeLines,
    "Nothing was written.",
  ];
}

/** Runs the bulk task import; resolves the process exit code. */
export async function runImportTasksCli(argv: readonly string[], deps: ImportCliDeps): Promise<number> {
  const { env, out, err } = deps;
  const args = parseImportArgs(argv);
  if (!args.ok) {
    err(args.message);
    err(IMPORT_USAGE);
    return 2;
  }

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    err("DATABASE_URL is required");
    return 2;
  }
  const discordBotToken = env.DISCORD_BOT_TOKEN?.trim() || undefined;
  let appBaseUrl = "";
  if (discordBotToken !== undefined) {
    try {
      appBaseUrl = parseAppBaseUrl(env.APP_BASE_URL);
    } catch (error) {
      err(errorMessage(error));
      return 2;
    }
  }

  let text: string;
  try {
    text = args.source === "-" ? await deps.readStdin() : await deps.readFile(args.source);
  } catch (error) {
    err(`cannot read ${args.source === "-" ? "stdin" : args.source}: ${errorMessage(error)}`);
    return 2;
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error) {
    err(`file: invalid JSON (${errorMessage(error)})`);
    return 1;
  }

  const notifications = deps.createPublisher({ discordBotToken, appBaseUrl });
  const { store, close } = deps.openStore(databaseUrl);
  try {
    const result = await importTasks({ store, notifications }, args.slug, input, { dryRun: args.dryRun });
    switch (result.status) {
      case "project_not_found":
        err(`project "${args.slug}" not found`);
        return 2;
      case "invalid":
        for (const error of result.errors) err(formatImportError(error));
        err("Nothing was imported.");
        return 1;
      case "planned":
      case "imported":
        for (const line of describePlan(result.plan, result.status === "planned")) out(line);
        return 0;
    }
  } finally {
    await notifications.flush();
    await close();
  }
}
