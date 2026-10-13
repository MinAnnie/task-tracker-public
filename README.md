# Task Tracker

Multi-project dev task tracker. Projects contain tasks (keys like `RF-04`, unique per project) with a stage and a status (`todo | in_progress | in_review | done | blocked`). GitHub pull requests are linked to tasks when a task key appears in the branch name or PR title; PR events move linked tasks automatically (opened → `in_review`, merged → `done`) unless they have pending dependencies. Tasks also have a priority and can depend on other tasks of the same project; a task cannot be started until its dependencies are `done`.

Sign-in uses GitHub OAuth (`GET /auth/github`, callback `GET /auth/github/callback`) and requires a role. A GitHub account without a role is redirected to `/login?error=not_allowed&login=<login>`, where the web app explains it has no access yet. Roles: **admins** are the GitHub logins listed in `ADMIN_GITHUB_LOGINS`; **members** are GitHub logins that an admin adds from the app (stored in Postgres). The role is re-checked on every request, so removing a member ends their access immediately. Sessions are stored in Postgres (only a SHA-256 of the cookie token).

Admin API (admins only; mutations require a same-origin `Origin` header, and POST/PATCH require `Content-Type: application/json`):

- `GET /api/admin/members` — configured `admins` (read-only) and database `members`.
- `POST /api/admin/members` with `{ "githubLogin": "..." }` — add a member (`201`; `409` if already a member; `400` if invalid or already an admin).
- `DELETE /api/admin/members/:githubLogin` — remove a member, their sessions and project memberships, and unassign their tasks that are not `done`; unassigned `in_progress` tasks go back to `todo`, `in_review` and `blocked` keep their status (`204`; `404` if absent).
- `GET /api/admin/projects` — every project with `repositoryCount`, `taskCount` and `memberCount`.
- `POST /api/admin/projects` with `{ "name", "slug", "taskKeyPrefix", "discordChannelId"? }` — create a project (`201`; `400` `invalid_*`; `409` `slug_taken` or `prefix_taken`). Slug: 1–50 lowercase letters, digits or single hyphens. Prefix: 1–10 letters/digits starting with a letter, stored uppercased (task keys look like `RF-14`). Discord channel: 17–20 digits or `null`.
- `GET /api/admin/projects/:slug` — the project with its `repositories` and `members` (`404` `project_not_found`).
- `PATCH /api/admin/projects/:slug` — partial update of `name`, `slug`, `taskKeyPrefix`, `discordChannelId` (`null` clears it) (`200`; `400` `empty_update`/`invalid_*`; `409` `slug_taken`, `prefix_taken`, or `prefix_locked` when changing the prefix of a project that has tasks).
- `DELETE /api/admin/projects/:slug` — delete the project with its repositories, tasks and memberships (`204`).
- `POST /api/admin/projects/:slug/repositories` with `{ "fullName": "owner/repo" }` — link a GitHub repository, stored lowercased (`201`; `400` `invalid_repository_name`; `409` `repository_taken` if any project already has it). `DELETE /api/admin/projects/:slug/repositories/:owner/:repo` unlinks it (`204`; `404`).
- `POST /api/admin/projects/:slug/members` with `{ "githubLogin": "..." }` — give an app member access to the project (`201`; `404` `member_not_found` if not added under `/api/admin/members` first; `400` `already_admin`, since admins see every project; `409` `already_project_member`). `DELETE /api/admin/projects/:slug/members/:githubLogin` removes it and unassigns their tasks in that project that are not `done`, with the same status rule (`in_progress` → `todo`) (`204`; `404`).

Project API (any signed-in user; `401` otherwise):

- `GET /api/projects` — `id`, `slug`, `name`, `taskKeyPrefix` of the projects the caller can see: admins see all, members only the projects they belong to.

Tasks API (project participants: admins, or members of the project — `403` `forbidden` otherwise, `404` `project_not_found` for an unknown project; mutations need the same `Origin`/`Content-Type: application/json` headers as the admin API, including the bodyless take/release; `DELETE` needs only the `Origin`). Task keys in paths are case-insensitive. A dependency is *pending* while its status is not `done`.

- `GET /api/projects/:slug/tasks` — the board, sorted by priority (`urgent`, `high`, `medium`, `low`) then key number. Each task: `key`, `title`, `status`, `priority`, `stage`, `assignee` (`{ login, name, avatarUrl }` or `null`), `pullRequests` (`number`, `state`, `url`), `dependsOn` and `pendingDependencies` (keys), and `canTake` (unassigned, not `done`, nothing pending).
- `POST /api/projects/:slug/tasks` with `{ "title", "description"?, "priority"?, "stage"?, "assigneeLogin"? }` — create a task keyed `<PREFIX>-<n>`, numbered past any existing `<PREFIX>-<digits>` key (`201` with the task detail; `400` `invalid_*` or `invalid_assignee`). Title 1–200 characters, description up to 10000, stage up to 50, priority defaults to `medium`. An assignee must be a project participant who signed in at least once; the task then starts `in_progress`, otherwise `todo`.
- `GET /api/projects/:slug/participants` — who can be assigned tasks in the project: configured admins and project members who signed in at least once, each `{ login, name, avatarUrl }`, sorted by login. Same access rules as the tasks routes.
- `GET /api/projects/:slug/tasks/:key` — the task with `description`, `dependsOn` and `blocks` (`key`, `title`, `status`), and linked `pullRequests` (`number`, `title`, `branch`, `url`, `state`, `author`) (`404` `task_not_found`).
- `POST /api/projects/:slug/tasks/:key/take` — assign the task to the caller; `todo` moves to `in_progress` (`200`; `409` `task_taken`, `task_done`, or `dependencies_pending` with `pendingDependencies`). Two concurrent takes never both win.
- `POST /api/projects/:slug/tasks/:key/release` — unassign; `in_progress` goes back to `todo` (`200`; only the assignee or an admin, `403`; `409` `task_not_assigned`).
- `PATCH /api/projects/:slug/tasks/:key` — partial update. `title`, `description`, `stage` (`null` clears the last two) and `priority`: any participant. `status`: the assignee or an admin. `assigneeLogin` (`null` unassigns): admins only, target must be a participant (`400` `invalid_assignee`). Moving to `in_progress`, `in_review` or `done`, or assigning, while dependencies are pending → `409` `dependencies_pending` (`400` `empty_update`/`invalid_*`).
- `POST /api/projects/:slug/tasks/:key/dependencies` with `{ "dependsOnKey" }` — the task now depends on another task of the same project (`201` with that task's `key`, `title`, `status`; `400` `self_dependency`/`invalid_task_key`; `404` `task_not_found`; `409` `dependency_exists` or `dependency_cycle`). `DELETE /api/projects/:slug/tasks/:key/dependencies/:dependsOnKey` removes it (`204`; `404`).
- `DELETE /api/projects/:slug/tasks/:key` — admins only (`403` `forbidden` for members): delete the task for good, with its dependency edges in both directions and its pull request links; the pull requests themselves stay (`204`; `404` `task_not_found`). Its key is never reused: new tasks keep numbering past it. The task detail's `blocks` and `pullRequests` tell what the deletion affects.

Pull request events still link tasks with pending dependencies, but leave their status unchanged.

### Discord notifications

With `DISCORD_BOT_TOKEN` set, a Discord bot (REST API only, no gateway connection) posts one-line messages to the project's `discordChannelId`; projects without a channel stay silent. It announces:

- every task created from the web or the API: `🆕 \`KEY\` title · Priority · by login — link`, with a `🔥 **URGENT**` marker for urgent tasks and `· assigned to <assignee>` when created with an assignee;
- a bulk import (see [Bulk task import](#bulk-task-import)), as one summary message instead of one per task;
- a task taken (`✋ <assignee> took \`KEY\` title — link`, from the web or `/take`), or assigned by an admin through `assigneeLogin` (`📌 <assignee> was assigned \`KEY\` title by login — link`);
- a linked pull request opened, reopened or merged (one message per pull request, listing its task keys; redeliveries stay silent);
- a task that is not done whose last pending dependency became `done` (status change or merge), was removed, or was deleted while not done.

Messages link to the task (`<APP_BASE_URL>/projects/<slug>/tasks/<key>`) or the pull request and escape Discord markdown in user text (titles, logins, project names), so it can never mention or ping anyone.

`<assignee>` is a Discord mention (`<@id>`) when the assignee has [linked their Discord account](#discord-account-linking) and the stored id is a valid snowflake (17–20 digits); otherwise it is their GitHub login as plain text. Mentions are disabled (`allowed_mentions: { parse: [] }`) except in one case: when someone else gave the task to a linked assignee (an admin assigning it, or creating it assigned to them), that message pings only the assignee (`allowed_mentions: { users: [id] }`). Taking a task, assigning it to yourself, imports, pull requests and unblocked tasks never ping. They are sent in the background after the database transaction commits, so a slow or failing Discord never affects the request or the webhook; failures are logged and dropped (a `429` is retried once). Invite the bot to the server with permission to send messages in those channels.

### Discord account linking

With `DISCORD_APPLICATION_ID` and `DISCORD_CLIENT_SECRET` set, signed-in users can connect their Discord account from the account menu, so Discord features can tell which task-tracker user a Discord user is. Only the `identify` scope is requested; the access token is used once to read the account id and display name, then discarded.

- `GET /auth/discord` — needs a session (otherwise redirects to `/login`); stores a random state in an HttpOnly cookie scoped to `/auth/discord` and redirects to Discord's consent screen.
- `GET /auth/discord/callback` — checks the state, links the account to the session's user and always redirects to `/?discord=<outcome>`: `linked`, `already_linked` (that Discord account belongs to another user; nothing changes), `cancelled` (consent denied) or `failed` (bad state, missing code, or Discord unreachable; logged). Linking another Discord account replaces the previous one.
- `DELETE /auth/discord` — disconnects the caller's Discord account (`204`; same-origin only).
- `GET /auth/me` includes `discord` (`{ id, username }` or `null`) and `discordLinkingEnabled`.

All three routes answer `404` `discord_linking_disabled` while linking is not configured.

### Discord slash commands

With `DISCORD_PUBLIC_KEY` set, Discord delivers slash commands to `POST /discord/interactions` (HTTP interactions, no gateway). Requests are verified with Ed25519 (`X-Signature-Ed25519` over `X-Signature-Timestamp` + raw body); a missing or invalid signature gets `401`, bodies over 64 KB get `413`, and without the key the route answers `404`. The route has no cookies, so the same-origin/JSON guards of the cookie API do not apply to it.

Commands run in the channel of a project (`discordChannelId`) and reuse the web's task use cases, so access, dependency and race rules (and channel notifications) are identical. The caller must have linked their Discord account (account menu → Connect Discord) and still be an admin or member; members only reach projects they belong to. Replies are ephemeral (only the caller sees them) and never mention anyone.

- `/tasks` — tasks you can take now (unassigned, not done, no pending dependencies), sorted like the board, up to 15.
- `/mine` — your unfinished tasks, grouped by status.
- `/task key:<KEY>` — status, priority, assignee, pending dependencies and link.
- `/take key:<KEY>` / `/release key:<KEY>` — same as the buttons in the web app.

Keys are case-insensitive, and the `key` option autocompletes from the channel's project (takeable tasks for `/take`, yours for `/release`).

Setup, in the [Discord developer portal](https://discord.com/developers/applications) for the same application as account linking:

1. **General Information**: copy the **Public Key** into `DISCORD_PUBLIC_KEY`, deploy, then set **Interactions Endpoint URL** to `<APP_BASE_URL>/discord/interactions` (Discord sends a signed PING when saving it, so the app must already run with the key).
2. **Installation**: the bot needs the `applications.commands` scope in the server (re-invite it with `bot` + `applications.commands` if it was invited with `bot` only).
3. Register the commands (again whenever their definitions change). It needs `DISCORD_APPLICATION_ID` and `DISCORD_BOT_TOKEN`; with `DISCORD_GUILD_ID` set it registers them in that server only, which applies instantly (global commands can take a while to appear):
   - locally: `pnpm --filter @task-tracker/server discord:register` (reads `.env`);
   - in production (Dokploy), inside the running app container, which already has the variables: `docker exec <app-container> node dist/discord-register.js` (or `docker exec -e DISCORD_GUILD_ID=<guild id> <app-container> node dist/discord-register.js`).

Planned (not implemented yet): GitHub App webhooks.

### Bulk task import

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

### API tokens

Scripts and AI agents can read one project's tasks with a token instead of a browser login.

- **Create**: Admin → the project → **API tokens**: give it a name and an expiry (30, 90 (default) or 365 days, or never). The token (`ttk_…`) is shown **once**; copy it then. Only its SHA-256 hash is stored; the list shows its first 8 characters, who created it, last use (updated at most once a minute) and status.
- **Scope**: one project, read only. A request for another project's slug answers `404 project_not_found`.
- **Endpoints** (`Authorization: Bearer <token>`, GET only): `/api/projects` (just the token's project), `/api/projects/<slug>/tasks`, `/api/projects/<slug>/tasks/<key>`, `/api/projects/<slug>/participants`. Responses match the web app's (`canTake` is always `false`). Every other endpoint and every non-GET request with a bearer header answer `403 token_not_allowed`, even alongside a session cookie. If a request carries both a cookie and a bearer token, the token is used (least privilege).
- Unknown, malformed, revoked and expired tokens all answer `401 invalid_token`. Each token may make 120 requests per minute (per server process); beyond that, `429 rate_limited` with `Retry-After`.
- **OpenAPI**: `GET /api/openapi.json` (public) describes these endpoints.
- **Revoke**: the token's **Revoke** button; anything using it gets `401` immediately.

Keep the token in an environment variable (e.g. on the VPS), never in code or logs:

```sh
export TRACKER_API_TOKEN=ttk_...   # e.g. in the agent's env file
curl -H "Authorization: Bearer $TRACKER_API_TOKEN" https://your-tracker.example.com/api/projects/<slug>/tasks
```

### MCP server

`apps/mcp` is a read-only [MCP](https://modelcontextprotocol.io) server over stdio that lets AI agents (Claude Code and others) browse a project with an API token: `list_projects`, `list_tasks` (board filters), `get_task` (the "Copy for AI" brief) and `next_tasks` (ready tasks and what they unblock). It needs `TRACKER_API_TOKEN` and `TRACKER_API_URL` (your instance, e.g. `https://your-tracker.example.com`). Build, configuration and Claude Code registration: [apps/mcp/README.md](apps/mcp/README.md).

## Layout

- `apps/server` — Hono API (Node 24, TypeScript), Drizzle ORM + PostgreSQL, Vitest. Pure domain logic lives in `src/domain/`.
- `apps/web` — React + Vite single-page app (React Router, TanStack Query, CSS Modules with design tokens in `src/styles/tokens.css`), tested with Vitest + Testing Library. Built to static files served by the server in production. Screens live in `src/features/<feature>/` (containers fetch data, presentational components render props), shared primitives in `src/ui/`, the typed API client in `src/api/`.
- `apps/mcp` — read-only MCP server (stdio) over the API-token endpoints, built with `@modelcontextprotocol/sdk` and zod.

## Local development

```sh
corepack enable
pnpm install
cp .env.example .env            # set POSTGRES_PASSWORD / DATABASE_URL

# start only Postgres, published on loopback (only POSTGRES_PASSWORD is needed for this)
POSTGRES_PASSWORD=change-me docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait db

pnpm dev        # server on :3000 (runs migrations on startup), web on :5173
pnpm test       # Vitest (unit)
pnpm test:integration  # Vitest against Postgres (needs the db container above)
pnpm typecheck
pnpm build
pnpm db:generate  # generate a migration after editing apps/server/src/db/schema.ts
```

In development open the app at http://localhost:5173. Vite proxies `/api`, `/auth` and `/health` to the server on :3000 without rewriting the `Origin` header, so set `APP_BASE_URL=http://localhost:5173` in `.env` and use `http://localhost:5173/auth/github/callback` as the callback URL of your development GitHub OAuth app. The same-origin check on mutations then passes, and the OAuth flow returns to the dev server.

Full stack in Docker, with ports published locally:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
curl http://127.0.0.1:3000/health
```

## Environment variables

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (built automatically in `docker-compose.yml`). |
| `PORT` | HTTP port of the server (default `3000`). |
| `GITHUB_WEBHOOK_SECRET` | Secret used to verify GitHub webhook signatures. Required. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Credentials of the GitHub OAuth app used for login. Required. |
| `ADMIN_GITHUB_LOGINS` | Comma-separated GitHub logins with the admin role (case-insensitive). Admins manage members from the app. Required; empty fails startup. |
| `APP_BASE_URL` | Public origin of the app, e.g. `https://your-tracker.example.com`. The OAuth callback is `<APP_BASE_URL>/auth/github/callback`; cookies get `Secure` when it is https. Required. |
| `DISCORD_BOT_TOKEN` | Token of the Discord bot that posts project notifications. Optional; when unset, notifications are disabled (logged once at startup). Never logged. |
| `DISCORD_APPLICATION_ID` / `DISCORD_CLIENT_SECRET` | OAuth2 client id and secret of the Discord application used to link accounts. Optional, but set both or neither (only one fails startup); when unset, linking is disabled. Add `<APP_BASE_URL>/auth/discord/callback` as a redirect in the Discord developer portal. The secret is never logged. |
| `DISCORD_PUBLIC_KEY` | Public key (64 hex characters) of the Discord application, used to verify slash command requests. Optional; when unset, `POST /discord/interactions` answers `404`. A malformed value fails startup. |
| `DISCORD_GUILD_ID` | Only read by the `discord:register` script: registers the commands in this server instead of globally. |
| `WEB_DIST_DIR` | Directory of the built web app to serve at `/` (set in the Docker image). |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Database credentials used by Compose. `POSTGRES_PASSWORD` is required. |

## Deploy on Dokploy

1. Create a **Compose** app pointing at this repository (compose file: `docker-compose.yml`).
2. Set the environment variables in the Dokploy UI: `POSTGRES_PASSWORD` (required by Compose) plus the app variables above. Compose does not enforce the app variables; the app refuses to start when any is missing.
3. In **Domains**, add your domain targeting service `app`, port `3000`. Dokploy's Traefik handles routing and TLS; the compose file publishes no host ports.
4. Deploy. Migrations run automatically on app startup; `GET /health` reports DB connectivity.
