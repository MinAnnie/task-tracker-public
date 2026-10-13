# Bulk task import

`import-tasks` creates many tasks (and their dependencies) in a project from a JSON file:

```json
{ "tasks": [
  { "ref": "monorepo", "title": "Set up the monorepo", "priority": "urgent", "stage": "Etapa 0", "description": "...", "dependsOn": [] },
  { "key": "RF-02", "title": "Auth0 login", "priority": "high", "stage": "Etapa 1 · Autenticación", "dependsOn": ["monorepo"], "status": "done" }
]}
```

- Each task has either an explicit `key` or a `ref` (a local name, not stored), never both. Explicit keys are uppercased, must look like `PREFIX-123` (1–10 letters or digits starting with a letter), optionally followed by one letter (`AUTH-08b`, stored as `AUTH-08B`), and must not exist in the project; they are stored as given (`RF-02` stays zero-padded, so branches like `feat/RF-02-auth0` link to it; `feat/AUTH-08b-return` links to `AUTH-08B`, not `AUTH-08`). Suffixed keys never move the project's generated-key counter. Tasks with a `ref` get generated keys with the project's prefix, in file order, after every existing or explicit key with that prefix.
- Fields: `key` or `ref`, `title` (required), `priority` (`urgent`, `high`, `medium` (default) or `low`), `stage`, `description`, `dependsOn` and `status` (all optional). `dependsOn` lists keys or refs of the same file, or keys of tasks already in the project (case-insensitive).
- `status` is `todo` (default), `done` or `blocked`; imported tasks are unassigned, so `in_progress` and `in_review` are rejected (import as `todo` and take them in the app). A `done` task may only depend on tasks (in the file or in the project) that are `done`; the error names the pending ones. `todo` and `blocked` tasks may depend on anything. A later pull request linked to an imported `done` task leaves it `done`.
- An optional top-level `dependencies` array adds edges whose dependent task may already exist in the project: `"dependencies": [{ "task": "RF-12", "dependsOn": ["DOM-02"] }]`. `task` and each `dependsOn` item are keys of existing tasks (case-insensitive, suffixed keys like `AUTH-08b` included) or keys/refs of the same file. Edges that already exist are skipped and counted as "already present", so re-running the file is idempotent; duplicates within the file are merged. A `done` task may only gain dependencies that are `done` (other statuses may gain any). `tasks` may be empty or omitted when `dependencies` is given; a file with neither is rejected.
- Everything is validated first (fields, statuses, duplicate keys/refs, unknown keys and dependencies, cycles across existing edges, the file's tasks and the `dependencies` entries); every error is printed, one per line, with the offending task (`task #3 (monorepo): unknown dependency "x"`) or `dependencies` entry (`dependency #2 (RF-12): unknown dependency "x"`), and nothing is written. Otherwise everything is written in one transaction: the new tasks, their dependencies, then the `dependencies` edges.
- After the commit, one Discord message is posted to the project's channel: `📥 Imported N tasks into <project> (K with explicit keys, D already done). Board: <link>` (`D already done` only when D > 0; no per-task messages; nothing when the file only adds edges; skipped without `DISCORD_BOT_TOKEN`).
- `--dry-run` validates and prints the plan (generated key ← ref mapping, dependency count, root tasks, count per status, the `dependencies` edges it would add) without writing. With a `dependencies` section, the summary line adds `N added dependencies on existing tasks (M already present)`.
- Exit codes: `0` ok, `1` validation errors, `2` usage or configuration errors (including an unknown project). Needs `DATABASE_URL`; `DISCORD_BOT_TOKEN` and `APP_BASE_URL` for the summary message.

Run it:

- locally (reads `.env`; relative paths resolve from `apps/server`, so pass an absolute path or `-` for stdin): `pnpm --filter @task-tracker/server import:tasks --project <slug> --dry-run /abs/path/tasks.json`;
- in production (Dokploy → the app service → **Terminal**, or `docker exec -i <app-container> …`), which already has the variables; pipe the file through stdin: `node /app/apps/server/dist/import-tasks.js --project <slug> --dry-run - < tasks.json`, then again without `--dry-run`. In the Dokploy terminal, where there is no local file, paste it with a heredoc: `node /app/apps/server/dist/import-tasks.js --project <slug> - <<'EOF'` … `EOF`.
