import { describe, expect, it, vi } from "vitest";
import { createTrackerClient, READ_ONLY_TOKEN_MESSAGE, TrackerApiError } from "./client.ts";

const TOKEN = "ttk_secretsecretsecretsecretsecretsecretsecret1";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function setup(respond: (url: string, init: RequestInit) => Response | Promise<Response>, apiUrl = "http://api.test") {
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => respond(String(input), init ?? {}));
  const client = createTrackerClient({ apiUrl, token: TOKEN, fetch, timeoutMs: 50 });
  return { client, fetch };
}

async function failure(promise: Promise<unknown>): Promise<TrackerApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(TrackerApiError);
    expect((error as Error).message).not.toContain(TOKEN);
    expect((error as Error).message).not.toContain("secret");
    return error as TrackerApiError;
  }
  throw new Error("expected a failure");
}

describe("TrackerClient requests", () => {
  it("sends a Bearer token and JSON accept header on GET /api/projects", async () => {
    const { client, fetch } = setup(() => json(200, [{ id: 1, slug: "rf", name: "RF", taskKeyPrefix: "RF" }]));
    await expect(client.listProjects()).resolves.toEqual([{ id: 1, slug: "rf", name: "RF", taskKeyPrefix: "RF" }]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/projects");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("accept")).toBe("application/json");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("joins a base URL with a path prefix and trailing slash, encoding slug and key", async () => {
    const { client, fetch } = setup(() => json(200, []), "https://host.test/tracker/");
    await client.listTasks("my proj");
    await client.getTask("rf", "RF/1");
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://host.test/tracker/api/projects/my%20proj/tasks",
      "https://host.test/tracker/api/projects/rf/tasks/RF%2F1",
    ]);
  });
});

describe("TrackerClient errors", () => {
  it("maps 401 to an invalid token message", async () => {
    const { client } = setup(() => json(401, { error: "invalid_token" }));
    const error = await failure(client.listProjects());
    expect(error.message).toBe("The token is invalid, expired or revoked (401 invalid_token).");
    expect(error.kind).toBe("unauthorized");
  });

  it("maps 403 to a not-allowed message", async () => {
    const { client } = setup(() => json(403, { error: "token_not_allowed" }));
    expect((await failure(client.listProjects())).message).toBe(
      "The token is not allowed to call this endpoint (403 token_not_allowed).",
    );
  });

  it("maps 404 project_not_found and task_not_found", async () => {
    const project = setup(() => json(404, { error: "project_not_found" }));
    const projectError = await failure(project.client.listTasks("nope"));
    expect(projectError.kind).toBe("not_found");
    expect(projectError.message).toBe('Project "nope" was not found (or is not visible to this token).');

    const task = setup(() => json(404, { error: "task_not_found" }));
    expect((await failure(task.client.getTask("rf", "RF-9"))).message).toBe(
      'Task "RF-9" was not found in project "rf".',
    );
  });

  it("maps 429 to a rate limit message with Retry-After", async () => {
    const { client } = setup(() => json(429, { error: "rate_limited" }, { "retry-after": "42" }));
    const error = await failure(client.listProjects());
    expect(error.kind).toBe("rate_limited");
    expect(error.retryAfterSeconds).toBe(42);
    expect(error.message).toBe("Rate limited by the Task Tracker API; retry after 42 seconds.");
  });

  it("maps 429 without Retry-After", async () => {
    const { client } = setup(() => json(429, { error: "rate_limited" }));
    expect((await failure(client.listProjects())).message).toBe(
      "Rate limited by the Task Tracker API; retry in a minute.",
    );
  });

  it("maps other statuses to a generic HTTP error", async () => {
    const { client } = setup(() => new Response("boom", { status: 502 }));
    const error = await failure(client.listProjects());
    expect(error.kind).toBe("http");
    expect(error.message).toBe("The Task Tracker API answered HTTP 502.");
  });

  it("maps network failures to unreachable, without leaking the token", async () => {
    const { client } = setup(() => {
      throw new TypeError(`fetch failed: Authorization: Bearer ${TOKEN}`);
    });
    const error = await failure(client.listProjects());
    expect(error.kind).toBe("unreachable");
    expect(error.message).toMatch(/^The Task Tracker API at http:\/\/api\.test is unreachable/);
    expect(error.message).toContain("[redacted]");
  });

  it("times out slow responses", async () => {
    const { client } = setup(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const error = await failure(client.listProjects());
    expect(error.kind).toBe("unreachable");
    expect(error.message).toBe("The Task Tracker API at http://api.test did not respond within 0.05 seconds.");
  });

  it("rejects a response that is not JSON", async () => {
    const { client } = setup(() => new Response("<html>", { status: 200 }));
    const error = await failure(client.listProjects());
    expect(error.kind).toBe("http");
    expect(error.message).toBe("The Task Tracker API answered with invalid JSON.");
  });
});

describe("TrackerClient writes", () => {
  const detail = { key: "RF-15", title: "Docs" };

  it("creates a task with a JSON POST", async () => {
    const { client, fetch } = setup(() => json(201, detail));
    await expect(client.createTask("rf", { title: "Docs", dependsOnKeys: ["RF-1"] })).resolves.toEqual(detail);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/projects/rf/tasks");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ title: "Docs", dependsOnKeys: ["RF-1"] });
  });

  it("updates a task, adds and removes dependencies", async () => {
    const { client, fetch } = setup((url, init) =>
      init.method === "DELETE" ? new Response(null, { status: 204 }) : json(init.method === "POST" ? 201 : 200, detail),
    );
    await client.updateTask("rf", "RF/1", { status: "done" });
    await client.addDependency("rf", "RF-1", "RF-2");
    await expect(client.removeDependency("rf", "RF-1", "RF/2")).resolves.toBeUndefined();
    expect(fetch.mock.calls.map(([url, init]) => [init?.method, String(url), init?.body])).toEqual([
      ["PATCH", "http://api.test/api/projects/rf/tasks/RF%2F1", JSON.stringify({ status: "done" })],
      ["POST", "http://api.test/api/projects/rf/tasks/RF-1/dependencies", JSON.stringify({ dependsOnKey: "RF-2" })],
      ["DELETE", "http://api.test/api/projects/rf/tasks/RF-1/dependencies/RF%2F2", undefined],
    ]);
  });

  it("explains that a read-only token cannot write", async () => {
    const { client } = setup(() => json(403, { error: "token_not_allowed" }));
    const error = await failure(client.createTask("rf", { title: "X" }));
    expect(error.kind).toBe("read_only");
    expect(error.message).toBe(READ_ONLY_TOKEN_MESSAGE);
    expect(READ_ONLY_TOKEN_MESSAGE).toBe(
      "This token is read-only. Create a Read & write token in Admin → the project → API tokens.",
    );
  });

  it("explains a forbidden write", async () => {
    const { client } = setup(() => json(403, { error: "forbidden" }));
    expect((await failure(client.updateTask("rf", "RF-1", { status: "done" }))).message).toBe(
      "Not allowed (403 forbidden): changing a task's status needs the token's creator to be its assignee or an admin, and the creator must still have access to the project.",
    );
  });

  it("names the refused field, unknown dependencies and pending dependencies", async () => {
    const invalid = setup(() => json(400, { error: "invalid_stage" }));
    const stage = await failure(invalid.client.createTask("rf", { title: "X", stage: "Nope" }));
    expect(stage.kind).toBe("rejected");
    expect(stage.message).toBe("The Task Tracker API refused the change (400 invalid_stage).");

    const unknown = setup(() => json(400, { error: "invalid_dependency", unknownKeys: ["RF-9"] }));
    expect((await failure(unknown.client.createTask("rf", { title: "X" }))).message).toBe(
      "The Task Tracker API refused the change (400 invalid_dependency). Unknown task keys: RF-9.",
    );

    const pending = setup(() => json(409, { error: "dependencies_pending", pendingDependencies: ["RF-2", "RF-3"] }));
    expect((await failure(pending.client.updateTask("rf", "RF-1", { status: "in_progress" }))).message).toBe(
      "The Task Tracker API refused the change (409 dependencies_pending). Pending dependencies: RF-2, RF-3.",
    );
  });

  it("reports a missing dependency on removal", async () => {
    const { client } = setup(() => json(404, { error: "dependency_not_found" }));
    expect((await failure(client.removeDependency("rf", "RF-1", "RF-2"))).message).toBe(
      "RF-1 does not depend on RF-2 in project \"rf\".",
    );
  });
});
