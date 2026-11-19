# Task Tracker MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server. It lets AI agents read Task Tracker projects through an API token and, with a **Read & write** token, create and edit their tasks and dependencies.

## Remote or local?

The same tools, with the same descriptions, schemas and output, are available two ways:

- **Remote, nothing to install (recommended)**: the Task Tracker server itself serves them at `<APP_BASE_URL>/mcp` (for example `https://your-tracker.example.com/mcp`) over MCP Streamable HTTP. Give your client that URL and the header `Authorization: Bearer <token>`. In the web app, account menu → **Connect your AI** has copy-paste setup per client. For Claude Code:

  ```sh
  claude mcp add --transport http --scope user task-tracker https://your-tracker.example.com/mcp --header "Authorization: Bearer <YOUR_TOKEN>"
  ```

  It runs the server's use cases in-process as the token, so the access rules below are enforced exactly as on the REST API. It is stateless (`POST` only; `GET`/`DELETE` answer `405`), answers `401` with `WWW-Authenticate: Bearer` without a valid token, caps bodies at 256 KB and batches at 10 messages, and shares the token's rate limit (120 requests per minute; each message counts). `TRACKER_PROJECT` does not exist there: pass `project` when a personal token sees several projects.
- **Local, over stdio**: this package's `dist/index.js`, which calls the REST API with `TRACKER_API_TOKEN`. The rest of this page is about it. It keeps working as before.

The tools are defined once, in `src/server.ts` (`createTrackerMcpServer`), over the `TrackerClient` port (`src/client.ts`). The stdio entry gives it the HTTP client; `apps/server` imports the package (`@task-tracker/mcp`, entry `src/lib.ts`) and gives it an in-process client. `apiError` maps an API failure (status, code) to the tool's message for both, so errors read the same.

## Personal or project token?

The server works with both kinds of token:

| | Personal token | Project token |
| --- | --- | --- |
| Created by | Any signed-in user, for themselves (account menu → **API tokens**) | An admin (Admin → project → **API tokens**) |
| Reaches | Every project its owner can access right now: all of them for an admin, the projects a member belongs to | That one project |
| Access | Members: read only. Admins: read only or read & write | Read only or read & write |
| Acts as | Its owner, with their current role | The admin who created it, with their current access |

**Admins working across projects: use a personal token.** One token covers every project, so you don't need one per project. A project token fits a bot or script that should only ever touch one project.

With a personal token, `list_projects` returns every project you can access. The other tools need to know the project: pass `project` (a slug from `list_projects`), or set `TRACKER_PROJECT` as the default. Without either, a tool answers with the visible slugs and asks for `project`. If the token sees exactly one project, that one is used.

A personal token stops working as soon as its owner loses their role, and it is revoked when the member is removed.

| Tool | What it returns |
| --- | --- |
| `list_projects` | The projects the token can see (slug, name, key prefix): one for a project token, every accessible project for a personal token. |
| `list_tasks` | The board as compact lines (`KEY · status · priority · stage · assignee · title`, plus "waiting on …"), sorted by priority and then key. It shows total vs shown counts. Filters: `availability` (`any`/`ready`/`blocked`), `status[]`, `priority[]`, `stage[]` (`""` = no stage), `assignee` (`any`/`unassigned`/login), `search`, `limit` (default 50, max 200). |
| `get_task` | One task as the web's "Copy for AI" markdown brief: status, dependencies, what it blocks, PRs, the suggested branch `feat/<KEY>-<slug>`, a link, and the description. |
| `next_tasks` | Ready tasks, most urgent first, each with why it is ready and what it unblocks (`limit`, default 10). |
| `create_task` | **Modifies data.** Creates a task (`title`, optional `description`, `priority`, `stage`, `dependsOn` keys) and returns its brief. It starts unassigned in `todo`. |
| `update_task` | **Modifies data.** Changes `title`, `description`, `priority`, `stage` or `status` of a task (`null` clears the description or stage) and returns its brief. The assignee can't be changed with a token. |
| `add_dependency` | **Modifies data.** Makes `key` depend on `dependsOn` (same project; cycles are refused). |
| `remove_dependency` | **Modifies data.** Removes that dependency. |

Every tool except `list_projects` takes an optional `project` slug (see above).

The four write tools need a token created with **Read & write** access. They act as the user who created the token (project token) or owns it (personal token), with that user's current access, and Discord notifications name that user. Only admins can hold a read & write personal token. With a read-only token they fail with: "This token is read-only. Create a Read & write token in Admin → the project → API tokens."

A task is **ready** when it is unassigned, not done, and has no pending dependency. The server computes this itself because the API always answers `canTake: false` to tokens.

## Build

```sh
pnpm install
pnpm --filter @task-tracker/mcp build    # → apps/mcp/dist/index.js
```

## Configuration (environment)

| Variable | Default | Meaning |
| --- | --- | --- |
| `TRACKER_API_TOKEN` | — (required) | An API token (`ttk_…`): **Read only** for the read tools, **Read & write** to also use the write tools. Create a personal one in the account menu → **API tokens**, or a project one in Admin → project → **API tokens**. If it is missing, the server still starts, but every tool answers `TRACKER_API_TOKEN is not set`. |
| `TRACKER_API_URL` | — (required) | The Task Tracker base URL, e.g. `https://your-tracker.example.com`. Task links use it too. If it is missing, the server still starts, but every tool answers `TRACKER_API_URL is not set`. |
| `TRACKER_PROJECT` | — | The default project slug; a `project` argument still wins. Without it, the server uses the token's only project, or asks for `project` when a personal token sees several. |

The token goes only into the `Authorization` header. It is never logged. stdout is the MCP channel, and the one startup line on stderr does not include the token. Error messages redact it.

### Put the token in your shell, not in a config file

Type this yourself in a terminal. Paste your own token; don't share it with an agent:

```sh
echo 'export TRACKER_API_TOKEN=ttk_your_token_here' >> ~/.bashrc
echo 'export TRACKER_API_URL=https://your-tracker.example.com' >> ~/.bashrc
# optional:
echo 'export TRACKER_PROJECT=your-project-slug' >> ~/.bashrc
source ~/.bashrc
```

The `echo` above lands in your shell history. To avoid that, edit `~/.bashrc` with an editor. You can also start the line with a space when `HISTCONTROL` includes `ignorespace`.

## Register in Claude Code (user scope, all projects)

```sh
claude mcp add --scope user -e TRACKER_API_URL=https://your-tracker.example.com --transport stdio task-tracker -- node /path/to/task-tracker/apps/mcp/dist/index.js
```

- `--scope user` stores the server in `~/.claude.json`, so it is available in every project. Check it with `claude mcp get task-tracker` or `/mcp` inside Claude Code.
- No `-e TRACKER_API_TOKEN=…`: the token is not written into any config file. The server inherits it from the environment Claude Code was started in.
- `-e TRACKER_API_URL=…` stores your instance URL in the config (the URL is not a secret). Alternatively, export `TRACKER_API_URL` in your shell like the token and omit `-e`. For a local API, use `-e TRACKER_API_URL=http://localhost:3001`.
- Optionally, `-e 'TRACKER_API_TOKEN=${TRACKER_API_TOKEN}'` (single quotes) stores the literal placeholder, and Claude Code expands it at launch. It adds nothing over inheritance. When the variable is unset, the placeholder is passed through as is, and this server then treats it as "not set".

### What was verified vs assumed

Verified with Claude Code 2.1.295, using an isolated `CLAUDE_CONFIG_DIR` and a probe wrapper that recorded whether the variable arrived:

- `claude mcp add --scope user …` writes `mcpServers.<name>` into the user config file `.claude.json`. Without `-e`, `env` is `{}`.
- When `claude mcp get` health-checks a stdio server, the server process inherits `TRACKER_API_TOKEN` from the environment `claude` runs in, even with no `-e`.
- `-e 'TRACKER_API_TOKEN=${TRACKER_API_TOKEN}'` is stored literally. It is expanded at launch when the variable is set and passed through literally when it is unset.

Assumed (not tested here):

- Interactive sessions spawn MCP servers with the same environment as `claude mcp get`. The docs do not state that stdio servers inherit the environment.
- Claude Code only sees the variable when it is started from a shell that loaded `~/.bashrc`, such as a terminal. An IDE or desktop launcher started outside such a shell may lack it. In that case, start the IDE from a terminal, or put the variable where that launcher reads its environment.

## Tests

```sh
pnpm --filter @task-tracker/mcp test        # unit tests (client, filters, formatters, tools, protocol, library entry)
```

End-to-end smoke test, which is not part of `pnpm test`. It starts `dist/index.js` over stdio with the SDK client, checks that `tools/list` has all eight tools, and calls `list_projects`, `list_tasks`, `next_tasks` and `get_task` against a running API. It never calls a write tool:

```sh
pnpm --filter @task-tracker/mcp build
TRACKER_API_URL=http://localhost:3002 TRACKER_API_TOKEN=... pnpm --filter @task-tracker/mcp smoke
```

Add `--remote` to make the same calls to the server's remote endpoint (`$TRACKER_API_URL/mcp`) over Streamable HTTP instead; nothing is spawned. Both modes print the same tool output for the same token.

```sh
TRACKER_API_URL=http://localhost:3002 TRACKER_API_TOKEN=... pnpm --filter @task-tracker/mcp smoke --remote
```

The server's tests also drive `/mcp` with the SDK's Streamable HTTP client (`apps/server/src/mcp/mcp-endpoint.test.ts`): the tool list matches this server's, a read-only token cannot use the write tools, and a project token sees only its project.
