# Task Tracker MCP server

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server over stdio. It lets AI agents read one Task Tracker project through a project-scoped API token. It never writes anything.

| Tool | What it returns |
| --- | --- |
| `list_projects` | The projects the token can see (slug, name, key prefix). |
| `list_tasks` | The board as compact lines (`KEY · status · priority · stage · assignee · title`, plus "waiting on …"), sorted by priority and then key. It shows total vs shown counts. Filters: `availability` (`any`/`ready`/`blocked`), `status[]`, `priority[]`, `stage[]` (`""` = no stage), `assignee` (`any`/`unassigned`/login), `search`, `limit` (default 50, max 200). |
| `get_task` | One task as the web's "Copy for AI" markdown brief: status, dependencies, what it blocks, PRs, the suggested branch `feat/<KEY>-<slug>`, a link, and the description. |
| `next_tasks` | Ready tasks, most urgent first, each with why it is ready and what it unblocks (`limit`, default 10). |

A task is **ready** when it is unassigned, not done, and has no pending dependency. The server computes this itself because the API always answers `canTake: false` to tokens.

## Build

```sh
pnpm install
pnpm --filter @task-tracker/mcp build    # → apps/mcp/dist/index.js
```

## Configuration (environment)

| Variable | Default | Meaning |
| --- | --- | --- |
| `TRACKER_API_TOKEN` | — (required) | A read-only token (`ttk_…`). Create it in Admin → project → **API tokens**. If it is missing, the server still starts, but every tool answers `TRACKER_API_TOKEN is not set`. |
| `TRACKER_API_URL` | — (required) | The Task Tracker base URL, e.g. `https://your-tracker.example.com`. Task links use it too. If it is missing, the server still starts, but every tool answers `TRACKER_API_URL is not set`. |
| `TRACKER_PROJECT` | — | The default project slug. Without it, the server uses the token's only project. |

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
pnpm --filter @task-tracker/mcp test        # unit tests (client, filters, formatters, tools, protocol)
```

End-to-end smoke test, which is not part of `pnpm test`. It starts `dist/index.js` over stdio with the SDK client and calls `tools/list`, `list_projects`, `list_tasks`, `next_tasks` and `get_task` against a running API:

```sh
pnpm --filter @task-tracker/mcp build
TRACKER_API_URL=http://localhost:3002 TRACKER_API_TOKEN=... pnpm --filter @task-tracker/mcp smoke
```
