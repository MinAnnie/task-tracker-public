/**
 * End-to-end smoke test (not part of `pnpm test`): starts the built server (dist/index.js)
 * over stdio with the SDK client and calls tools/list, list_tasks, next_tasks and get_task
 * against a running Task Tracker API. It never calls the write tools, so any token works.
 * With `--remote` it makes the same calls to the server's remote endpoint
 * (`$TRACKER_API_URL/mcp`, Streamable HTTP) instead, with nothing spawned.
 *
 *   pnpm --filter @task-tracker/mcp build
 *   TRACKER_API_URL=http://localhost:3001 TRACKER_API_TOKEN=... pnpm --filter @task-tracker/mcp smoke
 *   TRACKER_API_URL=http://localhost:3001 TRACKER_API_TOKEN=... pnpm --filter @task-tracker/mcp smoke --remote
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const passthrough = ["TRACKER_API_TOKEN", "TRACKER_API_URL", "TRACKER_PROJECT"] as const;
const env: Record<string, string> = { ...getDefaultEnvironment() };
for (const name of passthrough) {
  const value = process.env[name];
  if (value !== undefined) env[name] = value;
}
if (!env.TRACKER_API_TOKEN || !env.TRACKER_API_URL) {
  console.error("Set TRACKER_API_TOKEN and TRACKER_API_URL first.");
  process.exit(2);
}

type TextResult = { isError?: boolean; content: { type: string; text?: string }[] };
const textOf = (result: unknown) =>
  (result as TextResult).content.map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("");

const remote = process.argv.includes("--remote");
const apiUrl = env.TRACKER_API_URL.replace(/\/+$/, "");
const transport = remote
  ? new StreamableHTTPClientTransport(new URL(`${apiUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${env.TRACKER_API_TOKEN}` } },
    })
  : new StdioClientTransport({ command: process.execPath, args: [serverPath], env, stderr: "inherit" });
console.log(remote ? `remote endpoint: ${apiUrl}/mcp` : `stdio server: ${serverPath}`);
const client = new Client({ name: "task-tracker-mcp-smoke", version: "1.0.0" });
let failed = false;

async function call(name: string, args: Record<string, unknown>): Promise<string> {
  const result = (await client.callTool({ name, arguments: args })) as TextResult;
  const text = textOf(result);
  const preview = text.split("\n").slice(0, 8).join("\n");
  console.log(`\n=== ${name} ${JSON.stringify(args)} ${result.isError ? "(isError)" : "ok"}\n${preview}`);
  if (result.isError) failed = true;
  return text;
}

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log(`tools/list: ${tools.map((t) => t.name).join(", ")}`);
  // 4 read tools + 4 write tools; the smoke test only calls the read ones.
  if (tools.length !== 8) failed = true;
  await call("list_projects", {});
  const list = await call("list_tasks", { limit: 5 });
  await call("list_tasks", { availability: "blocked", limit: 3 });
  await call("next_tasks", { limit: 3 });
  const firstKey = list.split("\n")[3]?.split(" · ")[0];
  if (firstKey) await call("get_task", { key: firstKey });
  else failed = true;
} finally {
  await client.close();
}

console.log(failed ? "\nSMOKE FAILED" : "\nSMOKE OK");
process.exit(failed ? 1 : 0);
