# HTTP API

All routes live under the same origin as the web app. Sessions come from GitHub sign-in (see [the README](../README.md)); scripts and agents can use [API tokens](#api-tokens) for read-only access.

## Authentication and roles

Sign-in uses GitHub OAuth (`GET /auth/github`, callback `GET /auth/github/callback`) and requires a role. A GitHub account without a role is redirected to `/login?error=not_allowed&login=<login>`, where the web app explains it has no access yet. Roles: **admins** are the GitHub logins listed in `ADMIN_GITHUB_LOGINS`; **members** are GitHub logins that an admin adds from the app (stored in Postgres). The role is re-checked on every request, so removing a member ends their access immediately. Sessions are stored in Postgres (only a SHA-256 of the cookie token).

## Admin API

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

## Projects API

Project API (any signed-in user; `401` otherwise):

- `GET /api/projects` — `id`, `slug`, `name`, `taskKeyPrefix` of the projects the caller can see: admins see all, members only the projects they belong to.

## Tasks API

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

## GitHub webhook

`POST /webhooks/github` receives `pull_request` events (other events answer `202` and are ignored). Every request must carry a valid `X-Hub-Signature-256` for `GITHUB_WEBHOOK_SECRET` (`401` otherwise). In the repository settings → **Webhooks**, use `<APP_BASE_URL>/webhooks/github`, content type `application/json`, the same secret, and the **Pull requests** event. The repository must be linked to a project (Admin → the project → repositories).

## API tokens

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
