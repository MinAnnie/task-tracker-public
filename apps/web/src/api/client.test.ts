import { describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "./client.ts";

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("apiRequest", () => {
  it("returns the parsed JSON body of a successful GET", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, [{ slug: "app" }]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/api/projects")).resolves.toEqual([{ slug: "app" }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
  });

  it("sends mutations as JSON, even without a body (the server requires the content type)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/projects/app/tasks/RF-1/take", { method: "POST" });
    await apiRequest("/api/projects/app/tasks", { method: "POST", body: { title: "Ship" } });

    const [, takeInit] = fetchMock.mock.calls[0]!;
    expect(new Headers(takeInit?.headers).get("content-type")).toBe("application/json");
    const [, createInit] = fetchMock.mock.calls[1]!;
    expect(createInit?.body).toBe(JSON.stringify({ title: "Ship" }));
  });

  it("resolves undefined for 204 No Content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await expect(apiRequest("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });

  it("rejects with an ApiError carrying the server's error code and extra fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(409, { error: "dependencies_pending", pendingDependencies: ["RF-13"] })),
    );

    const error = await apiRequest("/api/x", { method: "POST" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "dependencies_pending", pendingDependencies: ["RF-13"] });
  });

  it("uses a generic code when an error response has no JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Bad gateway", { status: 502 })));
    await expect(apiRequest("/api/x")).rejects.toMatchObject({ status: 502, code: "unknown_error" });
  });

  it("maps network failures to a network_error ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(apiRequest("/api/x")).rejects.toMatchObject({ status: 0, code: "network_error" });
  });
});
