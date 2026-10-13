import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import type { TrackerClient } from "./client.ts";
import { createServer } from "./server.ts";
import { listItem } from "./test-fixtures.ts";

async function connect(client: TrackerClient | undefined, { apiUrl }: { apiUrl?: string } = { apiUrl: "https://tracker.test" }) {
  const config = { token: client ? "ttk_x" : undefined, apiUrl, project: undefined };
  const server = createServer({ client, config });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), mcp.connect(clientSide)]);
  return mcp;
}

const fake: TrackerClient = {
  listProjects: vi.fn(async () => [{ id: 1, slug: "rf", name: "Rental Fleet", taskKeyPrefix: "RF" }]),
  listTasks: vi.fn(async () => [listItem({ key: "RF-1", title: "Board" })]),
  getTask: vi.fn(),
};

describe("MCP server", () => {
  it("exposes the four read-only tools with descriptions and schemas", async () => {
    const mcp = await connect(fake);
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_task", "list_projects", "list_tasks", "next_tasks"]);
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(40);
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
    const listTasks = tools.find((t) => t.name === "list_tasks")!;
    expect(Object.keys(listTasks.inputSchema.properties ?? {}).sort()).toEqual(
      ["assignee", "availability", "limit", "priority", "project", "search", "stage", "status"].sort(),
    );
    expect(tools.find((t) => t.name === "get_task")!.inputSchema.required).toEqual(["key"]);
  });

  it("calls a tool through the protocol", async () => {
    const mcp = await connect(fake);
    const result = await mcp.callTool({ name: "list_tasks", arguments: { availability: "ready" } });
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.content)).toContain("RF-1 · todo · medium");
  });

  it("rejects a limit above 200", async () => {
    const mcp = await connect(fake);
    const result = await mcp.callTool({ name: "list_tasks", arguments: { limit: 500 } });
    expect(result.isError).toBe(true);
  });

  it("answers isError results without a token", async () => {
    const mcp = await connect(undefined);
    const result = await mcp.callTool({ name: "list_projects", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("TRACKER_API_TOKEN is not set");
  });

  it("answers isError results without an API URL", async () => {
    const mcp = await connect(fake, {});
    const result = await mcp.callTool({ name: "list_projects", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("TRACKER_API_URL is not set");
  });
});
