import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import {
  apiError,
  createTrackerMcpServer,
  READ_ONLY_TOKEN_MESSAGE,
  TOOL_NAMES,
  TrackerApiError,
  type TrackerClient,
} from "./lib.ts";
import { listItem } from "./test-fixtures.ts";

const RF = { id: 1, slug: "rf", name: "Rental Fleet", taskKeyPrefix: "RF" };

function fakeClient(overrides: Partial<TrackerClient> = {}): TrackerClient {
  return {
    listProjects: vi.fn(async () => [RF]),
    listTasks: vi.fn(async () => [listItem({ key: "RF-1", title: "Board" })]),
    getTask: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    addDependency: vi.fn(),
    removeDependency: vi.fn(),
    ...overrides,
  };
}

async function connect(client: TrackerClient) {
  const server = createTrackerMcpServer({ client, config: { token: undefined, apiUrl: "https://t.test", project: undefined } });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), mcp.connect(clientSide)]);
  return mcp;
}

describe("createTrackerMcpServer (library entry)", () => {
  it("registers exactly the tools listed in TOOL_NAMES over any TrackerClient", async () => {
    const mcp = await connect(fakeClient());
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("formats the output of an injected client exactly like the stdio server", async () => {
    const mcp = await connect(fakeClient());
    const result = await mcp.callTool({ name: "list_projects", arguments: {} });
    expect(result.content).toEqual([{ type: "text", text: "1 project visible to this token:\n- rf · Rental Fleet · keys RF-<n>" }]);
  });

  it("shows a TrackerApiError thrown by the client as the tool's isError text", async () => {
    const client = fakeClient({
      createTask: vi.fn(async () => {
        throw apiError({ status: 403, code: "token_not_allowed" }, { slug: "rf", write: true });
      }),
    });
    const mcp = await connect(client);
    const result = await mcp.callTool({ name: "create_task", arguments: { title: "X" } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: READ_ONLY_TOKEN_MESSAGE }]);
  });
});

describe("apiError (shared HTTP status → tool message mapping)", () => {
  it("maps API failures exactly as the HTTP client does", () => {
    expect(apiError({ status: 404, code: "task_not_found" }, { slug: "rf", key: "RF-9" })).toEqual(
      new TrackerApiError("not_found", 'Task "RF-9" was not found in project "rf".'),
    );
    const rejected = apiError(
      { status: 400, code: "invalid_dependency", unknownKeys: ["RF-99"] },
      { slug: "rf", write: true },
    );
    expect(rejected.kind).toBe("rejected");
    expect(rejected.message).toBe(
      "The Task Tracker API refused the change (400 invalid_dependency). Unknown task keys: RF-99.",
    );
    const limited = apiError({ status: 429, code: "rate_limited", retryAfterSeconds: 12 }, {});
    expect([limited.kind, limited.message, limited.retryAfterSeconds]).toEqual([
      "rate_limited",
      "Rate limited by the Task Tracker API; retry after 12 seconds.",
      12,
    ]);
  });
});
