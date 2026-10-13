import { describe, expect, it, vi } from "vitest";
import { createTrackerClient, TrackerApiError } from "./client.ts";

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
