# MCP

AI agents (Claude Code, Cursor, VS Code Copilot and others) can use the tracker through the [Model Context Protocol](https://modelcontextprotocol.io) with an [API token](api.md#api-tokens).

| Tool | Needs | What it does |
| --- | --- | --- |
| `list_projects` | any token | The projects the token can see. |
| `list_tasks` | any token | The board as compact lines, with the board's filters. |
| `get_task` | any token | The "Copy for AI" brief of one task. |
| `next_tasks` | any token | Ready tasks, most urgent first, and what each one unblocks. |
| `create_task`, `update_task`, `add_dependency`, `remove_dependency` | **Read & write** token | Create and edit tasks and their dependencies, acting as the token's creator or owner. |

A personal token sees every project its owner can access, so pass `project` (a slug from `list_projects`) when it sees several.

## Two ways to connect

Both serve the same tools, with the same descriptions, schemas and output.

- **Remote (nothing to install, recommended)**: the server exposes the tools at `<APP_BASE_URL>/mcp` over MCP Streamable HTTP. Point the client at that URL with the header `Authorization: Bearer <token>`.
- **Local (stdio)**: `apps/mcp` runs the same tools as a local process that calls the REST API. It needs `TRACKER_API_TOKEN` and `TRACKER_API_URL` (there is no default URL). Build, configuration and registration: [apps/mcp/README.md](../apps/mcp/README.md).

## Connect your AI

In the web app, account menu → **Connect your AI** (`/account/ai`) shows this instance's endpoint URL, built from the address the app is served at, and copy-paste setup for Claude Code, Cursor, VS Code (Copilot), Windsurf, Codex CLI and Gemini CLI. Snippets use a `<YOUR_TOKEN>` placeholder and never a real token; create one under account menu → **API tokens**. ChatGPT is not supported yet (its custom connectors only offer OAuth or no authentication).

For example, with Claude Code:

```sh
claude mcp add --transport http --scope user task-tracker https://your-tracker.example.com/mcp --header "Authorization: Bearer <YOUR_TOKEN>"
```

## The remote endpoint

- `POST /mcp` only, stateless (no `Mcp-Session-Id`), answering JSON (no SSE). `GET` and `DELETE` answer `405` with `Allow: POST`. Clients must send `Accept: application/json, text/event-stream` and `Content-Type: application/json`, as MCP clients do.
- **Auth**: a personal or project API token, verified exactly like on the REST API. A missing, malformed, unknown, revoked or expired token answers `401 {"error":"invalid_token"}` with `WWW-Authenticate: Bearer`. The session cookie is never accepted, so the cookie API's `Origin` check does not apply; no CORS headers are sent.
- **Permissions**: the same as the token's REST access. Tools run the server's use cases in-process as the token (no HTTP loopback). With a read-only token the write tools answer the tool error "This token is read-only…".
- **Limits**: bodies up to 256 KB (`413` beyond), JSON-RPC batches of at most 10 messages (`400`). Each message counts against the token's rate limit (120 per minute per token and process; `429 rate_limited` with `Retry-After`).
- Tokens, headers and request bodies are never logged.

It needs no extra configuration: no new variables, and a reverse proxy that forwards the app's domain already forwards `/mcp`. Responses are plain JSON, so default proxy timeouts and buffering are fine. If a proxy strips the `Authorization` header or rewrites `/mcp`, clients get `401`/`404`.
