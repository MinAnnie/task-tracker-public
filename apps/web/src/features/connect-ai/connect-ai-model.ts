/** Name the server is registered under in every client's config. */
export const SERVER_NAME = "task-tracker";
/** Stands for the user's token: it is shown once, so snippets never contain a real one. */
export const TOKEN_PLACEHOLDER = "<YOUR_TOKEN>";

/** The remote MCP endpoint of this app (served by the API at `/mcp`). */
export const mcpEndpointUrl = (origin: string) => new URL("/mcp", origin).toString();

export interface ClientSnippet {
  id: string;
  /** Client name, also the section heading. */
  name: string;
  /** Where the snippet goes, before it. */
  instructions: string;
  code: string;
  /** Extra guidance after the snippet. */
  note?: string;
  /** Official documentation the format was checked against. */
  docsUrl: string;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);
const bearer = `Bearer ${TOKEN_PLACEHOLDER}`;

/** Copy-paste setup for each supported client, pointing at `endpoint`. */
export function clientSnippets(endpoint: string): ClientSnippet[] {
  return [
    {
      id: "claude-code",
      name: "Claude Code",
      instructions: "Run this in a terminal. --scope user makes the server available in all your projects.",
      code: `claude mcp add --transport http --scope user ${SERVER_NAME} ${endpoint} --header "Authorization: ${bearer}"`,
      note: "Check it with claude mcp get task-tracker, or /mcp inside Claude Code.",
      docsUrl: "https://code.claude.com/docs/en/mcp",
    },
    {
      id: "cursor",
      name: "Cursor",
      instructions: "Add this to ~/.cursor/mcp.json (all projects) or .cursor/mcp.json (one project).",
      code: json({ mcpServers: { [SERVER_NAME]: { url: endpoint, headers: { Authorization: bearer } } } }),
      note: "To keep the token out of the file, write \"Bearer ${env:TASK_TRACKER_TOKEN}\" and set that environment variable.",
      docsUrl: "https://cursor.com/docs/context/mcp",
    },
    {
      id: "vscode",
      name: "VS Code (GitHub Copilot)",
      instructions: "Add this to .vscode/mcp.json in your workspace (or run MCP: Open User Configuration).",
      code: json({
        inputs: [
          { type: "promptString", id: "task-tracker-token", description: "Task Tracker API token", password: true },
        ],
        servers: {
          [SERVER_NAME]: {
            type: "http",
            url: endpoint,
            headers: { Authorization: "Bearer ${input:task-tracker-token}" },
          },
        },
      }),
      note: "VS Code asks for the token the first time the server starts and stores it securely, so it never lands in the file.",
      docsUrl: "https://code.visualstudio.com/docs/copilot/reference/mcp-configuration",
    },
    {
      id: "windsurf",
      name: "Windsurf",
      instructions:
        "Add this to your MCP config file: ~/.codeium/windsurf/mcp_config.json, or the file that Cascade → MCP → “Open MCP config file” opens.",
      code: json({ mcpServers: { [SERVER_NAME]: { serverUrl: endpoint, headers: { Authorization: bearer } } } }),
      note: "To keep the token out of the file, write \"Bearer ${env:TASK_TRACKER_TOKEN}\" and set that environment variable.",
      docsUrl: "https://docs.devin.ai/windsurf/plugins/cascade/mcp",
    },
    {
      id: "codex",
      name: "Codex CLI",
      instructions: "Add this to ~/.codex/config.toml. Codex reads the token from an environment variable.",
      code: [`[mcp_servers.${SERVER_NAME}]`, `url = "${endpoint}"`, `bearer_token_env_var = "TASK_TRACKER_TOKEN"`].join("\n"),
      note: `Then set it in the shell that starts Codex: export TASK_TRACKER_TOKEN=${TOKEN_PLACEHOLDER}`,
      docsUrl: "https://learn.chatgpt.com/docs/config-file/config-reference",
    },
    {
      id: "gemini",
      name: "Gemini CLI",
      instructions: "Run this in a terminal. It adds the server to your Gemini CLI settings.",
      code: `gemini mcp add --transport http --header "Authorization: ${bearer}" ${SERVER_NAME} ${endpoint}`,
      note: "In settings.json the same server is an mcpServers entry with httpUrl and headers.",
      docsUrl: "https://geminicli.com/docs/tools/mcp-server/",
    },
  ];
}
