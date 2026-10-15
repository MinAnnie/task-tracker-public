import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createApp, type AppDeps } from "./app.ts";
import { createInMemoryRateLimiter } from "./infrastructure/in-memory-rate-limiter.ts";
import type { ApiTokenCaller, ApiTokenView } from "./application/api-tokens.ts";
import type { CompleteGithubLoginResult } from "./application/complete-github-login.ts";
import type { CompleteDiscordLinkResult } from "./application/discord-link.ts";
import type { AddMemberResult, MembersOverview } from "./application/members.ts";
import type { ProjectRecord, ProjectSummary } from "./application/project-store.ts";
import type { ProjectDetail } from "./application/projects.ts";
import type { BoardTask, TaskDetail } from "./application/tasks.ts";
import type { AuthenticatedUser } from "./application/sessions.ts";
import type { DiscordInteractionResponse } from "./webhooks/discord/handle-interaction.ts";
import type {
  PullRequestEventInput,
  PullRequestEventResult,
} from "./application/handle-pull-request-event.ts";

const webhookSecret = "test-secret";

const makeApp = (overrides: Partial<AppDeps> = {}) =>
  createApp({
    checkDatabase: async () => {},
    githubWebhookSecret: webhookSecret,
    handlePullRequestEvent: async () => ({ status: "ignored", reason: "unknown_repository" }),
    githubClientId: "client-id",
    appBaseUrl: "https://tasks.example.com",
    completeGithubLogin: async () => ({ status: "forbidden", login: "mallory" }),
    findSessionUser: async () => undefined,
    endSession: async () => {},
    listMembers: async () => ({ admins: [], members: [] }),
    addMember: async () => ({ status: "invalid_login" }),
    removeMember: async () => ({ status: "not_found" }),
    listProjects: async () => [],
    listVisibleProjects: async () => [],
    createProject: async () => ({ status: "invalid", field: "body" }),
    getProject: async () => ({ status: "not_found" }),
    updateProject: async () => ({ status: "not_found" }),
    deleteProject: async () => ({ status: "not_found" }),
    addProjectRepository: async () => ({ status: "project_not_found" }),
    removeProjectRepository: async () => ({ status: "project_not_found" }),
    addProjectMember: async () => ({ status: "project_not_found" }),
    removeProjectMember: async () => ({ status: "project_not_found" }),
    listTasks: async () => ({ status: "project_not_found" }),
    listParticipants: async () => ({ status: "project_not_found" }),
    getTask: async () => ({ status: "project_not_found" }),
    createTask: async () => ({ status: "project_not_found" }),
    takeTask: async () => ({ status: "project_not_found" }),
    releaseTask: async () => ({ status: "project_not_found" }),
    updateTask: async () => ({ status: "project_not_found" }),
    addTaskDependency: async () => ({ status: "project_not_found" }),
    removeTaskDependency: async () => ({ status: "project_not_found" }),
    deleteTask: async () => ({ status: "project_not_found" }),
    discordApplicationId: undefined,
    completeDiscordLink: async () => ({ status: "already_linked" }),
    findDiscordAccount: async () => null,
    unlinkDiscordAccount: async () => {},
    discordPublicKey: undefined,
    handleDiscordInteraction: async () => ({ type: 1 }),
    authenticateApiToken: async () => undefined,
    rateLimitApiToken: () => ({ allowed: true }),
    listApiTokens: async () => ({ status: "project_not_found" }),
    createApiToken: async () => ({ status: "project_not_found" }),
    revokeApiToken: async () => ({ status: "project_not_found" }),
    ...overrides,
  });

describe("GET /health", () => {
  it("returns 200 when the database is reachable", async () => {
    const app = makeApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", database: "ok" });
  });

  it("returns 503 when the database check fails", async () => {
    const app = makeApp({
      checkDatabase: async () => {
        throw new Error("connection refused");
      },
    });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error", database: "unreachable" });
  });
});

describe("POST /webhooks/github", () => {
  const sign = (body: string) =>
    `sha256=${createHmac("sha256", webhookSecret).update(body).digest("hex")}`;

  const deliver = (
    app: ReturnType<typeof makeApp>,
    body: string,
    { event = "pull_request", signature = sign(body) }: { event?: string; signature?: string | null } = {},
  ) => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-github-event": event,
    };
    if (signature !== null) headers["x-hub-signature-256"] = signature;
    return app.request("/webhooks/github", { method: "POST", headers, body });
  };

  const pullRequestBody = JSON.stringify({
    action: "opened",
    installation: { id: 99 },
    repository: { full_name: "acme/shop" },
    pull_request: {
      number: 7,
      title: "RF-04 checkout",
      html_url: "https://github.com/acme/shop/pull/7",
      state: "open",
      merged: false,
      created_at: "2026-01-01T10:00:00Z",
      merged_at: null,
      closed_at: null,
      user: { login: "octocat" },
      head: { ref: "feat/RF-04" },
    },
  });

  it("returns 401 when the signature is invalid", async () => {
    const handle = vi.fn();
    const app = makeApp({ handlePullRequestEvent: handle });
    const res = await deliver(app, pullRequestBody, { signature: `sha256=${"0".repeat(64)}` });
    expect(res.status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });

  it("returns 401 when the signature header is missing", async () => {
    const handle = vi.fn();
    const app = makeApp({ handlePullRequestEvent: handle });
    const res = await deliver(app, pullRequestBody, { signature: null });
    expect(res.status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });

  it("acknowledges ping events without processing them", async () => {
    const handle = vi.fn();
    const app = makeApp({ handlePullRequestEvent: handle });
    const res = await deliver(app, JSON.stringify({ zen: "Keep it simple." }), { event: "ping" });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "ignored", reason: "unsupported_event" });
    expect(handle).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed JSON body", async () => {
    const res = await deliver(makeApp(), "{not json");
    expect(res.status).toBe(400);
  });

  it("returns 400 when the pull_request payload is missing required fields", async () => {
    const res = await deliver(makeApp(), JSON.stringify({ action: "opened" }));
    expect(res.status).toBe(400);
  });

  it("passes the parsed payload to the use case and returns its result", async () => {
    const result: PullRequestEventResult = {
      status: "processed",
      pullRequestId: 1,
      linkedTaskKeys: ["RF-04"],
      statusChanges: [{ taskKey: "RF-04", from: "todo", to: "in_review" }],
    };
    const handle = vi.fn(async (_input: PullRequestEventInput) => result);
    const app = makeApp({ handlePullRequestEvent: handle });

    const res = await deliver(app, pullRequestBody);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
    expect(handle).toHaveBeenCalledOnce();
    expect(handle.mock.calls[0]?.[0]).toMatchObject({
      action: "opened",
      repositoryFullName: "acme/shop",
      installationId: 99,
      pullRequest: { number: 7, branch: "feat/RF-04", createdAt: new Date("2026-01-01T10:00:00Z") },
    });
  });

  it("returns 202 when the use case ignores the event", async () => {
    const res = await deliver(makeApp(), pullRequestBody);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "ignored", reason: "unknown_repository" });
  });

  it("returns 500 when the use case fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = makeApp({
      handlePullRequestEvent: async () => {
        throw new Error("db down");
      },
    });
    const res = await deliver(app, pullRequestBody);
    expect(res.status).toBe(500);
    error.mockRestore();
  });
});

/** Parses `Set-Cookie` headers into name → { value, attributes (lowercased) }. */
const setCookies = (res: Response) =>
  new Map(
    res.headers.getSetCookie().map((header) => {
      const [pair = "", ...attributes] = header.split(";").map((part) => part.trim());
      const eq = pair.indexOf("=");
      return [
        pair.slice(0, eq),
        { value: pair.slice(eq + 1), attributes: attributes.map((a) => a.toLowerCase()) },
      ] as const;
    }),
  );

const STATE_COOKIE = "oauth_state";
const SESSION_COOKIE = "session";

describe("GET /auth/github", () => {
  it("redirects to GitHub's authorize endpoint with client_id, redirect_uri and state", async () => {
    const res = await makeApp().request("/auth/github");

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("client-id");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://tasks.example.com/auth/github/callback",
    );
    expect(location.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  });

  it("stores the state in a short-lived, HttpOnly, SameSite=Lax cookie", async () => {
    const res = await makeApp().request("/auth/github");
    const state = new URL(res.headers.get("location")!).searchParams.get("state");
    const cookie = setCookies(res).get(STATE_COOKIE);

    expect(cookie?.value).toBe(state);
    expect(cookie?.attributes).toEqual(
      expect.arrayContaining(["httponly", "samesite=lax", "secure", "max-age=600"]),
    );
  });

  it("uses a fresh state on every request", async () => {
    const app = makeApp();
    const first = setCookies(await app.request("/auth/github")).get(STATE_COOKIE)?.value;
    const second = setCookies(await app.request("/auth/github")).get(STATE_COOKIE)?.value;
    expect(first).not.toBe(second);
  });

  it("omits Secure on cookies when the base URL is plain http", async () => {
    const app = makeApp({ appBaseUrl: "http://localhost:3000" });
    const res = await app.request("/auth/github");
    expect(setCookies(res).get(STATE_COOKIE)?.attributes).not.toContain("secure");
  });
});

describe("GET /auth/github/callback", () => {
  const callback = (
    app: ReturnType<typeof makeApp>,
    { query = "code=the-code&state=abc", cookieState = "abc" as string | null } = {},
  ) =>
    app.request(`/auth/github/callback?${query}`, {
      headers: cookieState === null ? {} : { cookie: `${STATE_COOKIE}=${cookieState}` },
    });

  const authenticated = (): CompleteGithubLoginResult => ({
    status: "authenticated",
    userId: 1,
    sessionToken: "session-token",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  it.each([
    ["the state cookie is missing", { cookieState: null }],
    ["the state query is missing", { query: "code=the-code" }],
    ["the state does not match", { cookieState: "other" }],
  ])("returns 400 without logging in when %s", async (_case, options) => {
    const complete = vi.fn();
    const res = await callback(makeApp({ completeGithubLogin: complete }), options);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_state" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("clears the state cookie", async () => {
    const res = await callback(makeApp({ completeGithubLogin: async () => authenticated() }));
    expect(setCookies(res).get(STATE_COOKIE)?.attributes).toContain("max-age=0");
  });

  it("returns 400 when the code is missing", async () => {
    const complete = vi.fn();
    const res = await callback(makeApp({ completeGithubLogin: complete }), {
      query: "error=access_denied&state=abc",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_code" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("sets the session cookie and redirects home after a successful login", async () => {
    const complete = vi.fn(async (_code: string) => authenticated());
    const res = await callback(makeApp({ completeGithubLogin: complete }));

    expect(complete).toHaveBeenCalledWith("the-code");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const cookie = setCookies(res).get(SESSION_COOKIE);
    expect(cookie?.value).toBe("session-token");
    expect(cookie?.attributes).toEqual(
      expect.arrayContaining(["httponly", "samesite=lax", "secure", "path=/"]),
    );
    const maxAge = Number(cookie?.attributes.find((a) => a.startsWith("max-age="))?.slice(8));
    expect(maxAge).toBeGreaterThan(30 * 24 * 60 * 60 - 10);
    expect(maxAge).toBeLessThanOrEqual(30 * 24 * 60 * 60);
  });

  it("redirects to the web login with an error flag, without a session cookie, when the login is not allowed", async () => {
    const res = await callback(makeApp());
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!, "https://tasks.example.com");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("not_allowed");
    expect(location.searchParams.get("login")).toBe("mallory");
    expect(setCookies(res).has(SESSION_COOKIE)).toBe(false);
  });

  it("returns 502 when the login cannot be completed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = makeApp({
      completeGithubLogin: async () => {
        throw new Error("bad_verification_code");
      },
    });
    const res = await callback(app);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "login_failed" });
    error.mockRestore();
  });
});

describe("GET /auth/me", () => {
  const user: AuthenticatedUser = {
    id: 1,
    githubLogin: "octocat",
    name: "The Octocat",
    avatarUrl: "https://avatars.example/1",
    role: "member",
  };

  it("returns the user behind the session cookie, including their role", async () => {
    const find = vi.fn(async (_token: string) => user);
    const res = await makeApp({ findSessionUser: find }).request("/auth/me", {
      headers: { cookie: `${SESSION_COOKIE}=session-token` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...user, discord: null, discordLinkingEnabled: false });
    expect(find).toHaveBeenCalledWith("session-token");
  });

  it("includes the linked Discord account and whether linking is enabled", async () => {
    const findDiscord = vi.fn(async (_userId: number) => ({ id: "80351110224678912", username: "Nelly" }));
    const res = await makeApp({
      findSessionUser: async () => user,
      findDiscordAccount: findDiscord,
      discordApplicationId: "1234",
    }).request("/auth/me", { headers: { cookie: `${SESSION_COOKIE}=session-token` } });

    expect(await res.json()).toEqual(
      expect.objectContaining({
        discord: { id: "80351110224678912", username: "Nelly" },
        discordLinkingEnabled: true,
      }),
    );
    expect(findDiscord).toHaveBeenCalledWith(1);
  });

  it("returns 401 without a session cookie", async () => {
    const find = vi.fn();
    const res = await makeApp({ findSessionUser: find }).request("/auth/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(find).not.toHaveBeenCalled();
  });

  it("returns 401 and clears the cookie for an unknown or expired session", async () => {
    const res = await makeApp().request("/auth/me", {
      headers: { cookie: `${SESSION_COOKIE}=stale` },
    });
    expect(res.status).toBe(401);
    expect(setCookies(res).get(SESSION_COOKIE)?.attributes).toContain("max-age=0");
  });
});

describe("POST /auth/logout", () => {
  it("ends the session, clears the cookie and returns 204", async () => {
    const end = vi.fn(async (_token: string) => {});
    const res = await makeApp({ endSession: end }).request("/auth/logout", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=session-token` },
    });
    expect(res.status).toBe(204);
    expect(end).toHaveBeenCalledWith("session-token");
    expect(setCookies(res).get(SESSION_COOKIE)?.attributes).toEqual(
      expect.arrayContaining(["max-age=0", "path=/"]),
    );
  });

  it("returns 204 without touching the store when there is no session cookie", async () => {
    const end = vi.fn();
    const res = await makeApp({ endSession: end }).request("/auth/logout", { method: "POST" });
    expect(res.status).toBe(204);
    expect(end).not.toHaveBeenCalled();
  });
});

const DISCORD_STATE_COOKIE = "discord_oauth_state";
const signedIn: AuthenticatedUser = {
  id: 7,
  githubLogin: "octocat",
  name: null,
  avatarUrl: null,
  role: "member",
};
/** App with Discord linking enabled and a signed-in user by default. */
const discordApp = (overrides: Partial<AppDeps> = {}) =>
  makeApp({ discordApplicationId: "1234", findSessionUser: async () => signedIn, ...overrides });

describe("GET /auth/discord", () => {
  const start = (app: ReturnType<typeof makeApp>, cookie: string | null = `${SESSION_COOKIE}=session-token`) =>
    app.request("/auth/discord", { headers: cookie === null ? {} : { cookie } });

  it("redirects to Discord's authorize endpoint with client_id, code response, identify scope, redirect_uri and state", async () => {
    const res = await start(discordApp());

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(location.searchParams.get("client_id")).toBe("1234");
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("scope")).toBe("identify");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://tasks.example.com/auth/discord/callback",
    );
    expect(location.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  });

  it("stores the state in a short-lived, HttpOnly, SameSite=Lax cookie scoped to /auth/discord", async () => {
    const res = await start(discordApp());
    const state = new URL(res.headers.get("location")!).searchParams.get("state");
    const cookie = setCookies(res).get(DISCORD_STATE_COOKIE);

    expect(cookie?.value).toBe(state);
    expect(cookie?.attributes).toEqual(
      expect.arrayContaining(["httponly", "samesite=lax", "secure", "max-age=600", "path=/auth/discord"]),
    );
  });

  it("uses a fresh state on every request", async () => {
    const app = discordApp();
    const first = setCookies(await start(app)).get(DISCORD_STATE_COOKIE)?.value;
    const second = setCookies(await start(app)).get(DISCORD_STATE_COOKIE)?.value;
    expect(first).not.toBe(second);
  });

  it("omits Secure on the state cookie when the base URL is plain http", async () => {
    const res = await start(discordApp({ appBaseUrl: "http://localhost:3000" }));
    expect(setCookies(res).get(DISCORD_STATE_COOKIE)?.attributes).not.toContain("secure");
  });

  it("sends visitors without a valid session to the login page, without a state cookie", async () => {
    const noCookie = await start(discordApp(), null);
    expect(noCookie.status).toBe(302);
    expect(noCookie.headers.get("location")).toBe("/login");
    expect(setCookies(noCookie).has(DISCORD_STATE_COOKIE)).toBe(false);

    const stale = await start(discordApp({ findSessionUser: async () => undefined }));
    expect(stale.status).toBe(302);
    expect(stale.headers.get("location")).toBe("/login");
    expect(setCookies(stale).get(SESSION_COOKIE)?.attributes).toContain("max-age=0");
  });

  it("returns 404 when Discord linking is disabled", async () => {
    const res = await start(makeApp({ findSessionUser: async () => signedIn }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "discord_linking_disabled" });
  });
});

describe("GET /auth/discord/callback", () => {
  const callback = (
    app: ReturnType<typeof makeApp>,
    {
      query = "code=the-code&state=abc",
      cookieState = "abc" as string | null,
      session = true,
    }: { query?: string; cookieState?: string | null; session?: boolean } = {},
  ) => {
    const cookies = [
      ...(session ? [`${SESSION_COOKIE}=session-token`] : []),
      ...(cookieState === null ? [] : [`${DISCORD_STATE_COOKIE}=${cookieState}`]),
    ];
    return app.request(`/auth/discord/callback?${query}`, {
      headers: cookies.length > 0 ? { cookie: cookies.join("; ") } : {},
    });
  };
  const flag = (res: Response) =>
    new URL(res.headers.get("location")!, "https://tasks.example.com").searchParams.get("discord");

  it("links the account for the session's user and redirects home with a linked flag", async () => {
    const complete = vi.fn(
      async (_userId: number, _code: string): Promise<CompleteDiscordLinkResult> => ({
        status: "linked",
        account: { id: "1", username: "Nelly" },
      }),
    );
    const res = await callback(discordApp({ completeDiscordLink: complete }));

    expect(complete).toHaveBeenCalledWith(7, "the-code");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?discord=linked");
  });

  it("redirects with already_linked when the Discord account belongs to another user", async () => {
    const res = await callback(discordApp({ completeDiscordLink: async () => ({ status: "already_linked" }) }));
    expect(res.status).toBe(302);
    expect(flag(res)).toBe("already_linked");
  });

  it("clears the state cookie", async () => {
    const res = await callback(discordApp());
    expect(setCookies(res).get(DISCORD_STATE_COOKIE)?.attributes).toEqual(
      expect.arrayContaining(["max-age=0", "path=/auth/discord"]),
    );
  });

  it.each([
    ["the state cookie is missing", { cookieState: null }],
    ["the state query is missing", { query: "code=the-code" }],
    ["the state does not match", { cookieState: "other" }],
  ])("redirects with failed, without linking, when %s", async (_case, options) => {
    const complete = vi.fn();
    const res = await callback(discordApp({ completeDiscordLink: complete }), options);
    expect(res.status).toBe(302);
    expect(flag(res)).toBe("failed");
    expect(complete).not.toHaveBeenCalled();
  });

  it("redirects with cancelled when Discord reports an error such as a denied consent", async () => {
    const complete = vi.fn();
    const res = await callback(discordApp({ completeDiscordLink: complete }), {
      query: "error=access_denied&error_description=cancelled&state=abc",
    });
    expect(flag(res)).toBe("cancelled");
    expect(complete).not.toHaveBeenCalled();
  });

  it("redirects with failed when the code is missing", async () => {
    const complete = vi.fn();
    const res = await callback(discordApp({ completeDiscordLink: complete }), { query: "state=abc" });
    expect(flag(res)).toBe("failed");
    expect(complete).not.toHaveBeenCalled();
  });

  it("logs and redirects with failed when Discord cannot complete the link", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await callback(
      discordApp({
        completeDiscordLink: async () => {
          throw new Error("Discord token exchange failed with status 400: invalid_grant");
        },
      }),
    );
    expect(res.status).toBe(302);
    expect(flag(res)).toBe("failed");
    expect(error).toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain("the-code");
    error.mockRestore();
  });

  it("sends visitors without a session to the login page without linking", async () => {
    const complete = vi.fn();
    const res = await callback(discordApp({ completeDiscordLink: complete, findSessionUser: async () => undefined }), {
      session: false,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
    expect(complete).not.toHaveBeenCalled();
  });

  it("returns 404 when Discord linking is disabled", async () => {
    const complete = vi.fn();
    const res = await callback(makeApp({ completeDiscordLink: complete, findSessionUser: async () => signedIn }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "discord_linking_disabled" });
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("DELETE /auth/discord", () => {
  const unlink = (
    app: ReturnType<typeof makeApp>,
    { origin = "https://tasks.example.com" as string | null, session = true } = {},
  ) => {
    const headers: Record<string, string> = {};
    if (session) headers.cookie = `${SESSION_COOKIE}=session-token`;
    if (origin !== null) headers.origin = origin;
    return app.request("/auth/discord", { method: "DELETE", headers });
  };

  it("unlinks the session user's Discord account and returns 204", async () => {
    const unlinkSpy = vi.fn(async (_userId: number) => {});
    const res = await unlink(discordApp({ unlinkDiscordAccount: unlinkSpy }));
    expect(res.status).toBe(204);
    expect(unlinkSpy).toHaveBeenCalledWith(7);
  });

  it.each([
    ["a foreign Origin", "https://evil.example"],
    ["no Origin", null],
  ])("returns 403 for %s without unlinking", async (_case, origin) => {
    const unlinkSpy = vi.fn();
    const res = await unlink(discordApp({ unlinkDiscordAccount: unlinkSpy }), { origin });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "invalid_origin" });
    expect(unlinkSpy).not.toHaveBeenCalled();
  });

  it("returns 401 without a session", async () => {
    const unlinkSpy = vi.fn();
    const res = await unlink(discordApp({ unlinkDiscordAccount: unlinkSpy, findSessionUser: async () => undefined }), {
      session: false,
    });
    expect(res.status).toBe(401);
    expect(unlinkSpy).not.toHaveBeenCalled();
  });

  it("returns 404 when Discord linking is disabled", async () => {
    const unlinkSpy = vi.fn();
    const res = await unlink(makeApp({ unlinkDiscordAccount: unlinkSpy, findSessionUser: async () => signedIn }));
    expect(res.status).toBe(404);
    expect(unlinkSpy).not.toHaveBeenCalled();
  });
});

const admin: AuthenticatedUser = {
  id: 1,
  githubLogin: "OctoCat",
  name: null,
  avatarUrl: null,
  role: "admin",
};
const member: AuthenticatedUser = { ...admin, id: 2, githubLogin: "mona", role: "member" };
const ORIGIN = "https://tasks.example.com";

/** Request helper for /api/admin: sends the session cookie plus same-origin JSON headers by default. */
const adminRequest = (
  app: ReturnType<typeof makeApp>,
  path: string,
  {
    method = "GET",
    body,
    cookie = `${SESSION_COOKIE}=session-token` as string | null,
    origin = ORIGIN as string | null,
    contentType = "application/json" as string | null,
  }: {
    method?: string;
    body?: string;
    cookie?: string | null;
    origin?: string | null;
    contentType?: string | null;
  } = {},
) => {
  const headers: Record<string, string> = {};
  if (cookie !== null) headers.cookie = cookie;
  if (origin !== null && method !== "GET") headers.origin = origin;
  if (contentType !== null && body !== undefined) headers["content-type"] = contentType;
  return app.request(path, { method, headers, body });
};

const asUser = (user: AuthenticatedUser | undefined) => ({
  findSessionUser: async () => user,
});

/** Spies for every admin use case, to assert none ran. */
const adminSpies = () => ({
  listMembers: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  listProjects: vi.fn(),
  createProject: vi.fn(),
  getProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  addProjectRepository: vi.fn(),
  removeProjectRepository: vi.fn(),
  addProjectMember: vi.fn(),
  removeProjectMember: vi.fn(),
  listApiTokens: vi.fn(),
  createApiToken: vi.fn(),
  revokeApiToken: vi.fn(),
});

describe("/api/admin authorization", () => {
  const routes = [
    ["GET", "/api/admin/members", undefined],
    ["POST", "/api/admin/members", JSON.stringify({ githubLogin: "mona" })],
    ["DELETE", "/api/admin/members/mona", undefined],
    ["GET", "/api/admin/projects", undefined],
    ["POST", "/api/admin/projects", JSON.stringify({ name: "Shop", slug: "shop", taskKeyPrefix: "RF" })],
    ["GET", "/api/admin/projects/shop", undefined],
    ["PATCH", "/api/admin/projects/shop", JSON.stringify({ name: "Shop" })],
    ["DELETE", "/api/admin/projects/shop", undefined],
    ["POST", "/api/admin/projects/shop/repositories", JSON.stringify({ fullName: "acme/shop" })],
    ["DELETE", "/api/admin/projects/shop/repositories/acme/shop", undefined],
    ["POST", "/api/admin/projects/shop/members", JSON.stringify({ githubLogin: "mona" })],
    ["DELETE", "/api/admin/projects/shop/members/mona", undefined],
    ["GET", "/api/admin/projects/shop/tokens", undefined],
    ["POST", "/api/admin/projects/shop/tokens", JSON.stringify({ name: "VPS" })],
    ["DELETE", "/api/admin/projects/shop/tokens/1", undefined],
  ] as const;

  it.each(routes)("%s %s returns 401 without a session", async (method, path, body) => {
    const find = vi.fn();
    const app = makeApp({ findSessionUser: find });
    const res = await adminRequest(app, path, { method, body, cookie: null });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(find).not.toHaveBeenCalled();
  });

  it.each(routes)("%s %s returns 401 and clears the cookie for a revoked session", async (method, path, body) => {
    const res = await adminRequest(makeApp(asUser(undefined)), path, { method, body });
    expect(res.status).toBe(401);
    expect(setCookies(res).get(SESSION_COOKIE)?.attributes).toContain("max-age=0");
  });

  it.each(routes)("%s %s returns 403 for a member", async (method, path, body) => {
    const spies = adminSpies();
    const app = makeApp({ ...asUser(member), ...spies });
    const res = await adminRequest(app, path, { method, body });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });
});

describe("/api/admin CSRF protection", () => {
  const mutations = [
    ["POST", "/api/admin/members", JSON.stringify({ githubLogin: "mona" })],
    ["DELETE", "/api/admin/members/mona", undefined],
    ["POST", "/api/admin/projects", JSON.stringify({ name: "Shop", slug: "shop", taskKeyPrefix: "RF" })],
    ["PATCH", "/api/admin/projects/shop", JSON.stringify({ name: "Shop" })],
    ["DELETE", "/api/admin/projects/shop", undefined],
    ["POST", "/api/admin/projects/shop/repositories", JSON.stringify({ fullName: "acme/shop" })],
    ["DELETE", "/api/admin/projects/shop/repositories/acme/shop", undefined],
    ["POST", "/api/admin/projects/shop/members", JSON.stringify({ githubLogin: "mona" })],
    ["DELETE", "/api/admin/projects/shop/members/mona", undefined],
    ["POST", "/api/admin/projects/shop/tokens", JSON.stringify({ name: "VPS" })],
    ["DELETE", "/api/admin/projects/shop/tokens/1", undefined],
  ] as const;

  it.each(mutations)("%s %s returns 403 without an Origin header", async (method, path, body) => {
    const spies = adminSpies();
    const app = makeApp({ ...asUser(admin), ...spies });
    const res = await adminRequest(app, path, { method, body, origin: null });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "invalid_origin" });
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });

  it.each(
    mutations.flatMap(([method, path, body]) =>
      ["https://evil.example.com", "http://tasks.example.com", "https://tasks.example.com.evil.io", "null"].map(
        (origin) => [method, path, origin, body] as const,
      ),
    ),
  )("%s %s returns 403 for the foreign origin %s", async (method, path, origin, body) => {
    const spies = adminSpies();
    const app = makeApp({ ...asUser(admin), ...spies });
    const res = await adminRequest(app, path, { method, body, origin });
    expect(res.status).toBe(403);
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });

  it.each([[null], ["text/plain"], ["application/x-www-form-urlencoded"], ["multipart/form-data"]])(
    "POST returns 415 for the content type %s",
    async (contentType) => {
      const add = vi.fn();
      const app = makeApp({ ...asUser(admin), addMember: add });
      const res = await adminRequest(app, "/api/admin/members", {
        method: "POST",
        body: JSON.stringify({ githubLogin: "mona" }),
        contentType,
      });
      expect(res.status).toBe(415);
      expect(await res.json()).toEqual({ error: "unsupported_media_type" });
      expect(add).not.toHaveBeenCalled();
    },
  );

  it.each(
    mutations
      .filter(([, , body]) => body !== undefined)
      .flatMap(([method, path, body]) =>
        [null, "text/plain", "application/x-www-form-urlencoded"].map(
          (contentType) => [method, path, contentType, body] as const,
        ),
      ),
  )("%s %s returns 415 for the content type %s", async (method, path, contentType, body) => {
    const spies = adminSpies();
    const app = makeApp({ ...asUser(admin), ...spies });
    const res = await adminRequest(app, path, { method, body, contentType });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "unsupported_media_type" });
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });

  it("accepts application/json with a charset parameter", async () => {
    const add = vi.fn(async (): Promise<AddMemberResult> => ({
      status: "created",
      member: { githubLogin: "mona", createdAt: new Date(), addedBy: "OctoCat" },
    }));
    const app = makeApp({ ...asUser(admin), addMember: add });
    const res = await adminRequest(app, "/api/admin/members", {
      method: "POST",
      body: JSON.stringify({ githubLogin: "mona" }),
      contentType: "Application/JSON; charset=utf-8",
    });
    expect(res.status).toBe(201);
  });
});

describe("GET /api/admin/members", () => {
  it("returns configured admins and members for an admin", async () => {
    const overview: MembersOverview = {
      admins: ["octocat"],
      members: [
        { githubLogin: "mona", createdAt: new Date("2026-03-01T12:00:00Z"), addedBy: "OctoCat" },
        { githubLogin: "bob", createdAt: new Date("2026-03-02T12:00:00Z"), addedBy: null },
      ],
    };
    const find = vi.fn(async () => admin);
    const app = makeApp({ findSessionUser: find, listMembers: async () => overview });

    const res = await adminRequest(app, "/api/admin/members");

    expect(res.status).toBe(200);
    expect(find).toHaveBeenCalledWith("session-token");
    expect(await res.json()).toEqual({
      admins: ["octocat"],
      members: [
        { githubLogin: "mona", createdAt: "2026-03-01T12:00:00.000Z", addedBy: "OctoCat" },
        { githubLogin: "bob", createdAt: "2026-03-02T12:00:00.000Z", addedBy: null },
      ],
    });
  });
});

describe("POST /api/admin/members", () => {
  const post = (app: ReturnType<typeof makeApp>, body: string) =>
    adminRequest(app, "/api/admin/members", { method: "POST", body });

  it("adds the member as the signed-in admin and returns 201", async () => {
    const add = vi.fn(async (): Promise<AddMemberResult> => ({
      status: "created",
      member: { githubLogin: "mona", createdAt: new Date("2026-03-01T12:00:00Z"), addedBy: "OctoCat" },
    }));
    const app = makeApp({ ...asUser(admin), addMember: add });

    const res = await post(app, JSON.stringify({ githubLogin: "Mona" }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      githubLogin: "mona",
      createdAt: "2026-03-01T12:00:00.000Z",
      addedBy: "OctoCat",
    });
    expect(add).toHaveBeenCalledWith({ githubLogin: "Mona", actor: admin });
  });

  it.each([
    [{ status: "invalid_login" }, 400, { error: "invalid_github_login" }],
    [{ status: "already_admin", githubLogin: "octocat" }, 400, { error: "already_admin" }],
    [{ status: "already_member", githubLogin: "mona" }, 409, { error: "already_member" }],
  ] as const)("maps %j to %i", async (result, status, body) => {
    const app = makeApp({ ...asUser(admin), addMember: async () => result });
    const res = await post(app, JSON.stringify({ githubLogin: "x" }));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });

  it("returns 400 for a malformed JSON body", async () => {
    const add = vi.fn();
    const res = await post(makeApp({ ...asUser(admin), addMember: add }), "{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "malformed_json" });
    expect(add).not.toHaveBeenCalled();
  });

  it("passes a missing githubLogin through as undefined for validation", async () => {
    const add = vi.fn(async (): Promise<AddMemberResult> => ({ status: "invalid_login" }));
    const res = await post(makeApp({ ...asUser(admin), addMember: add }), "null");
    expect(res.status).toBe(400);
    expect(add).toHaveBeenCalledWith({ githubLogin: undefined, actor: admin });
  });
});

describe("DELETE /api/admin/members/:githubLogin", () => {
  it("removes the member and returns 204", async () => {
    const remove = vi.fn(async () => ({ status: "removed" as const }));
    const app = makeApp({ ...asUser(admin), removeMember: remove });
    const res = await adminRequest(app, "/api/admin/members/Mona", { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(remove).toHaveBeenCalledWith("Mona");
  });

  it("returns 404 for an absent member", async () => {
    const app = makeApp({ ...asUser(admin) });
    const res = await adminRequest(app, "/api/admin/members/ghost", { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "member_not_found" });
  });
});

describe("auth and admin routes with the web app served", () => {
  it("take precedence over the SPA fallback", async () => {
    const webDistDir = mkdtempSync(join(tmpdir(), "web-dist-"));
    writeFileSync(join(webDistDir, "index.html"), "<!doctype html><title>spa</title>");
    try {
      const app = makeApp({ webDistDir });
      const me = await app.request("/auth/me");
      expect(me.status).toBe(401);
      expect(await me.json()).toEqual({ error: "unauthenticated" });
      expect((await app.request("/auth/github")).status).toBe(302);
      expect((await app.request("/api/admin/members")).status).toBe(401);
      expect(
        (await app.request("/api/admin/members/mona", { method: "DELETE" })).status,
      ).toBe(401);
      expect((await app.request("/api/admin/projects")).status).toBe(401);
      expect((await app.request("/api/admin/projects/shop")).status).toBe(401);
      expect(
        (await app.request("/api/admin/projects/shop/members/mona", { method: "DELETE" })).status,
      ).toBe(401);
      expect((await app.request("/api/projects")).status).toBe(401);
      expect((await app.request("/api/projects/shop/tasks")).status).toBe(401);
      expect((await app.request("/api/projects/shop/tasks/RF-1")).status).toBe(401);
      expect(
        (await app.request("/api/projects/shop/tasks/RF-1/dependencies/RF-2", { method: "DELETE" })).status,
      ).toBe(401);
      expect(await (await app.request("/some/page")).text()).toContain("spa");
    } finally {
      rmSync(webDistDir, { recursive: true, force: true });
    }
  });
});

const project: ProjectRecord = {
  id: 3,
  slug: "shop",
  name: "Shop",
  taskKeyPrefix: "RF",
  discordChannelId: null,
  createdAt: new Date("2026-03-01T12:00:00Z"),
};
const projectJson = { ...project, createdAt: "2026-03-01T12:00:00.000Z" };

describe("GET /api/admin/projects", () => {
  it("lists projects with their counts", async () => {
    const summary: ProjectSummary = { ...project, repositoryCount: 1, taskCount: 4, memberCount: 2 };
    const app = makeApp({ ...asUser(admin), listProjects: async () => [summary] });

    const res = await adminRequest(app, "/api/admin/projects");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { ...projectJson, repositoryCount: 1, taskCount: 4, memberCount: 2 },
    ]);
  });
});

describe("POST /api/admin/projects", () => {
  const post = (app: ReturnType<typeof makeApp>, body: string) =>
    adminRequest(app, "/api/admin/projects", { method: "POST", body });

  it("creates the project from the body and returns 201", async () => {
    const create = vi.fn(async () => ({ status: "created" as const, project }));
    const app = makeApp({ ...asUser(admin), createProject: create });
    const body = { name: "Shop", slug: "shop", taskKeyPrefix: "rf", discordChannelId: null };

    const res = await post(app, JSON.stringify(body));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(projectJson);
    expect(create).toHaveBeenCalledWith(body);
  });

  it.each([
    [{ status: "invalid", field: "body" }, 400, { error: "invalid_body" }],
    [{ status: "invalid", field: "name" }, 400, { error: "invalid_project_name" }],
    [{ status: "invalid", field: "slug" }, 400, { error: "invalid_project_slug" }],
    [{ status: "invalid", field: "taskKeyPrefix" }, 400, { error: "invalid_task_key_prefix" }],
    [{ status: "invalid", field: "discordChannelId" }, 400, { error: "invalid_discord_channel_id" }],
    [{ status: "slug_taken" }, 409, { error: "slug_taken" }],
    [{ status: "prefix_taken" }, 409, { error: "prefix_taken" }],
  ] as const)("maps %j to %i", async (result, status, body) => {
    const app = makeApp({ ...asUser(admin), createProject: async () => result });
    const res = await post(app, "{}");
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });

  it("returns 400 for a malformed JSON body", async () => {
    const create = vi.fn();
    const res = await post(makeApp({ ...asUser(admin), createProject: create }), "{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "malformed_json" });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/projects/:slug", () => {
  it("returns the project with repositories and members", async () => {
    const detail: ProjectDetail = {
      ...project,
      repositories: [{ fullName: "acme/shop", githubInstallationId: 99 }],
      members: [{ githubLogin: "mona", createdAt: new Date("2026-03-02T12:00:00Z") }],
    };
    const get = vi.fn(async () => ({ status: "found" as const, project: detail }));
    const app = makeApp({ ...asUser(admin), getProject: get });

    const res = await adminRequest(app, "/api/admin/projects/Shop");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ...projectJson,
      repositories: [{ fullName: "acme/shop", githubInstallationId: 99 }],
      members: [{ githubLogin: "mona", createdAt: "2026-03-02T12:00:00.000Z" }],
    });
    expect(get).toHaveBeenCalledWith("Shop");
  });

  it("returns 404 for an unknown project", async () => {
    const res = await adminRequest(makeApp(asUser(admin)), "/api/admin/projects/ghost");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "project_not_found" });
  });
});

describe("PATCH /api/admin/projects/:slug", () => {
  const patch = (app: ReturnType<typeof makeApp>, body: string) =>
    adminRequest(app, "/api/admin/projects/shop", { method: "PATCH", body });

  it("updates the project and returns it", async () => {
    const update = vi.fn(async () => ({ status: "updated" as const, project }));
    const app = makeApp({ ...asUser(admin), updateProject: update });

    const res = await patch(app, JSON.stringify({ discordChannelId: null }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(projectJson);
    expect(update).toHaveBeenCalledWith("shop", { discordChannelId: null });
  });

  it.each([
    [{ status: "not_found" }, 404, { error: "project_not_found" }],
    [{ status: "empty_update" }, 400, { error: "empty_update" }],
    [{ status: "invalid", field: "slug" }, 400, { error: "invalid_project_slug" }],
    [{ status: "slug_taken" }, 409, { error: "slug_taken" }],
    [{ status: "prefix_taken" }, 409, { error: "prefix_taken" }],
    [{ status: "prefix_locked" }, 409, { error: "prefix_locked" }],
  ] as const)("maps %j to %i", async (result, status, body) => {
    const app = makeApp({ ...asUser(admin), updateProject: async () => result });
    const res = await patch(app, "{}");
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });

  it("returns 400 for a malformed JSON body", async () => {
    const update = vi.fn();
    const res = await patch(makeApp({ ...asUser(admin), updateProject: update }), "{");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "malformed_json" });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/projects/:slug", () => {
  it("deletes the project and returns 204", async () => {
    const remove = vi.fn(async () => ({ status: "deleted" as const }));
    const app = makeApp({ ...asUser(admin), deleteProject: remove });
    const res = await adminRequest(app, "/api/admin/projects/shop", { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(remove).toHaveBeenCalledWith("shop");
  });

  it("returns 404 for an unknown project", async () => {
    const res = await adminRequest(makeApp(asUser(admin)), "/api/admin/projects/ghost", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "project_not_found" });
  });
});

describe("POST /api/admin/projects/:slug/repositories", () => {
  const post = (app: ReturnType<typeof makeApp>, body: string) =>
    adminRequest(app, "/api/admin/projects/shop/repositories", { method: "POST", body });

  it("links the repository and returns 201", async () => {
    const add = vi.fn(async () => ({
      status: "created" as const,
      repository: { fullName: "acme/shop", githubInstallationId: null },
    }));
    const app = makeApp({ ...asUser(admin), addProjectRepository: add });

    const res = await post(app, JSON.stringify({ fullName: "Acme/Shop" }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ fullName: "acme/shop", githubInstallationId: null });
    expect(add).toHaveBeenCalledWith("shop", "Acme/Shop");
  });

  it.each([
    [{ status: "invalid_repository" }, 400, { error: "invalid_repository_name" }],
    [{ status: "project_not_found" }, 404, { error: "project_not_found" }],
    [{ status: "repository_taken" }, 409, { error: "repository_taken" }],
  ] as const)("maps %j to %i", async (result, status, body) => {
    const app = makeApp({ ...asUser(admin), addProjectRepository: async () => result });
    const res = await post(app, "{}");
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });

  it("passes a missing fullName through as undefined for validation", async () => {
    const add = vi.fn(async () => ({ status: "invalid_repository" as const }));
    const res = await post(makeApp({ ...asUser(admin), addProjectRepository: add }), "[]");
    expect(res.status).toBe(400);
    expect(add).toHaveBeenCalledWith("shop", undefined);
  });

  it("returns 400 for a malformed JSON body", async () => {
    const add = vi.fn();
    const res = await post(makeApp({ ...asUser(admin), addProjectRepository: add }), "{");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "malformed_json" });
    expect(add).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/projects/:slug/repositories/:owner/:repo", () => {
  it("unlinks the repository and returns 204", async () => {
    const remove = vi.fn(async () => ({ status: "removed" as const }));
    const app = makeApp({ ...asUser(admin), removeProjectRepository: remove });
    const res = await adminRequest(app, "/api/admin/projects/shop/repositories/Acme/my.repo", {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
    expect(remove).toHaveBeenCalledWith("shop", "Acme/my.repo");
  });

  it.each([
    [{ status: "project_not_found" }, { error: "project_not_found" }],
    [{ status: "repository_not_found" }, { error: "repository_not_found" }],
  ] as const)("maps %j to 404", async (result, body) => {
    const app = makeApp({ ...asUser(admin), removeProjectRepository: async () => result });
    const res = await adminRequest(app, "/api/admin/projects/shop/repositories/acme/shop", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(body);
  });
});

describe("POST /api/admin/projects/:slug/members", () => {
  const post = (app: ReturnType<typeof makeApp>, body: string) =>
    adminRequest(app, "/api/admin/projects/shop/members", { method: "POST", body });

  it("adds the member to the project and returns 201", async () => {
    const add = vi.fn(async () => ({
      status: "created" as const,
      member: { githubLogin: "mona", createdAt: new Date("2026-03-02T12:00:00Z") },
    }));
    const app = makeApp({ ...asUser(admin), addProjectMember: add });

    const res = await post(app, JSON.stringify({ githubLogin: "Mona" }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ githubLogin: "mona", createdAt: "2026-03-02T12:00:00.000Z" });
    expect(add).toHaveBeenCalledWith("shop", "Mona");
  });

  it.each([
    [{ status: "invalid_login" }, 400, { error: "invalid_github_login" }],
    [{ status: "already_admin" }, 400, { error: "already_admin" }],
    [{ status: "project_not_found" }, 404, { error: "project_not_found" }],
    [{ status: "member_not_found" }, 404, { error: "member_not_found" }],
    [{ status: "already_project_member" }, 409, { error: "already_project_member" }],
  ] as const)("maps %j to %i", async (result, status, body) => {
    const app = makeApp({ ...asUser(admin), addProjectMember: async () => result });
    const res = await post(app, "{}");
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });

  it("returns 400 for a malformed JSON body", async () => {
    const add = vi.fn();
    const res = await post(makeApp({ ...asUser(admin), addProjectMember: add }), "{");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "malformed_json" });
    expect(add).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/projects/:slug/members/:githubLogin", () => {
  it("removes the member from the project and returns 204", async () => {
    const remove = vi.fn(async () => ({ status: "removed" as const }));
    const app = makeApp({ ...asUser(admin), removeProjectMember: remove });
    const res = await adminRequest(app, "/api/admin/projects/shop/members/Mona", {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
    expect(remove).toHaveBeenCalledWith("shop", "Mona");
  });

  it.each([
    [{ status: "project_not_found" }, { error: "project_not_found" }],
    [{ status: "project_member_not_found" }, { error: "project_member_not_found" }],
  ] as const)("maps %j to 404", async (result, body) => {
    const app = makeApp({ ...asUser(admin), removeProjectMember: async () => result });
    const res = await adminRequest(app, "/api/admin/projects/shop/members/mona", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(body);
  });
});

describe("GET /api/projects", () => {
  const refs = [{ id: 3, slug: "shop", name: "Shop", taskKeyPrefix: "RF" }];

  it.each([[admin], [member]])("returns the projects visible to %j", async (user) => {
    const list = vi.fn(async () => refs);
    const app = makeApp({ ...asUser(user), listVisibleProjects: list });

    const res = await adminRequest(app, "/api/projects");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(refs);
    expect(list).toHaveBeenCalledWith(user);
  });

  it("resolves the session once per request, for admin routes too", async () => {
    const find = vi.fn(async () => admin);
    const app = makeApp({ findSessionUser: find });
    await adminRequest(app, "/api/projects");
    await adminRequest(app, "/api/admin/projects");
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("returns 401 without a session", async () => {
    const list = vi.fn();
    const res = await adminRequest(makeApp({ listVisibleProjects: list }), "/api/projects", {
      cookie: null,
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(list).not.toHaveBeenCalled();
  });

  it("returns 401 and clears the cookie for a revoked session", async () => {
    const res = await adminRequest(makeApp(asUser(undefined)), "/api/projects");
    expect(res.status).toBe(401);
    expect(setCookies(res).get(SESSION_COOKIE)?.attributes).toContain("max-age=0");
  });
});

const boardTask: BoardTask = {
  key: "RF-1",
  title: "Checkout",
  status: "todo",
  priority: "high",
  stage: null,
  assignee: null,
  pullRequests: [],
  dependsOn: [],
  pendingDependencies: [],
  canTake: true,
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-02T10:00:00.000Z",
};

const taskDetail: TaskDetail = {
  key: "RF-1",
  title: "Checkout",
  description: "Use Wompi",
  status: "in_progress",
  priority: "high",
  stage: "Backend",
  assignee: { login: "mona", name: null, avatarUrl: null },
  canTake: false,
  pendingDependencies: [],
  dependsOn: [{ key: "RF-0", title: "API", status: "done" }],
  blocks: [],
  pullRequests: [],
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-02T10:00:00.000Z",
};

/** Spies for every task use case, to assert none ran. */
const taskSpies = () => ({
  listTasks: vi.fn(),
  listParticipants: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
  takeTask: vi.fn(),
  releaseTask: vi.fn(),
  updateTask: vi.fn(),
  addTaskDependency: vi.fn(),
  removeTaskDependency: vi.fn(),
  deleteTask: vi.fn(),
});

const taskRoutes = [
  ["GET", "/api/projects/shop/tasks", undefined],
  ["GET", "/api/projects/shop/participants", undefined],
  ["POST", "/api/projects/shop/tasks", JSON.stringify({ title: "Checkout" })],
  ["GET", "/api/projects/shop/tasks/RF-1", undefined],
  ["PATCH", "/api/projects/shop/tasks/RF-1", JSON.stringify({ title: "Checkout" })],
  ["POST", "/api/projects/shop/tasks/RF-1/take", "{}"],
  ["POST", "/api/projects/shop/tasks/RF-1/release", "{}"],
  ["POST", "/api/projects/shop/tasks/RF-1/dependencies", JSON.stringify({ dependsOnKey: "RF-2" })],
  ["DELETE", "/api/projects/shop/tasks/RF-1/dependencies/RF-2", undefined],
  ["DELETE", "/api/projects/shop/tasks/RF-1", undefined],
] as const;
const taskMutations = taskRoutes.filter(([method]) => method !== "GET");

describe("/api/projects/:slug/tasks authorization and CSRF protection", () => {
  it.each(taskRoutes)("%s %s returns 401 without a session", async (method, path, body) => {
    const spies = taskSpies();
    const res = await adminRequest(makeApp(spies), path, { method, body, cookie: null });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });

  it.each(taskRoutes)("%s %s returns 401 and clears the cookie for a revoked session", async (method, path, body) => {
    const res = await adminRequest(makeApp(asUser(undefined)), path, { method, body });
    expect(res.status).toBe(401);
    expect(setCookies(res).get(SESSION_COOKIE)?.attributes).toContain("max-age=0");
  });

  it.each(taskMutations)("%s %s returns 403 without an Origin header", async (method, path, body) => {
    const spies = taskSpies();
    const res = await adminRequest(makeApp({ ...asUser(member), ...spies }), path, { method, body, origin: null });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "invalid_origin" });
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });

  it.each(taskMutations)("%s %s returns 403 for a foreign origin", async (method, path, body) => {
    const spies = taskSpies();
    const app = makeApp({ ...asUser(member), ...spies });
    const res = await adminRequest(app, path, { method, body, origin: "https://evil.example.com" });
    expect(res.status).toBe(403);
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });

  it.each(
    taskMutations
      .filter(([method]) => method !== "DELETE")
      .flatMap(([method, path, body]) =>
        [null, "text/plain", "application/x-www-form-urlencoded"].map(
          (contentType) => [method, path, contentType, body] as const,
        ),
      ),
  )("%s %s returns 415 for the content type %s", async (method, path, contentType, body) => {
    const spies = taskSpies();
    const res = await adminRequest(makeApp({ ...asUser(member), ...spies }), path, { method, body, contentType });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "unsupported_media_type" });
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });

  it.each(taskRoutes)("%s %s maps project_not_found to 404 and forbidden to 403", async (method, path, body) => {
    const notFound = await adminRequest(makeApp(asUser(member)), path, { method, body });
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ error: "project_not_found" });

    const forbidden = async () => ({ status: "forbidden" as const });
    const app = makeApp({
      ...asUser(member),
      listTasks: forbidden,
      listParticipants: forbidden,
      getTask: forbidden,
      createTask: forbidden,
      takeTask: forbidden,
      releaseTask: forbidden,
      updateTask: forbidden,
      addTaskDependency: forbidden,
      removeTaskDependency: forbidden,
      deleteTask: forbidden,
    });
    const res = await adminRequest(app, path, { method, body });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it.each(taskMutations.filter(([, , body]) => body !== undefined && body !== "{}"))(
    "%s %s returns 400 for a malformed JSON body",
    async (method, path) => {
      const spies = taskSpies();
      const res = await adminRequest(makeApp({ ...asUser(member), ...spies }), path, { method, body: "{not json" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "malformed_json" });
      for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
    },
  );
});

describe("GET /api/projects/:slug/tasks", () => {
  it("returns the board for the signed-in user", async () => {
    const list = vi.fn(async () => ({ status: "ok" as const, tasks: [boardTask] }));
    const app = makeApp({ ...asUser(member), listTasks: list });

    const res = await adminRequest(app, "/api/projects/Shop/tasks");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([boardTask]);
    expect(list).toHaveBeenCalledWith(member, "Shop");
  });
});

describe("GET /api/projects/:slug/participants", () => {
  it("returns who can be assigned tasks in the project", async () => {
    const participants = [{ login: "mona", name: "Mona", avatarUrl: null }];
    const list = vi.fn(async () => ({ status: "ok" as const, participants }));
    const app = makeApp({ ...asUser(member), listParticipants: list });

    const res = await adminRequest(app, "/api/projects/Shop/participants");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(participants);
    expect(list).toHaveBeenCalledWith(member, "Shop");
  });
});

describe("GET /api/projects/:slug/tasks/:key", () => {
  it("returns the task", async () => {
    const get = vi.fn(async () => ({ status: "ok" as const, task: taskDetail }));
    const res = await adminRequest(makeApp({ ...asUser(member), getTask: get }), "/api/projects/shop/tasks/rf-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(taskDetail);
    expect(get).toHaveBeenCalledWith(member, "shop", "rf-1");
  });

  it("returns 404 for an unknown task", async () => {
    const app = makeApp({ ...asUser(member), getTask: async () => ({ status: "task_not_found" }) });
    const res = await adminRequest(app, "/api/projects/shop/tasks/RF-9");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "task_not_found" });
  });
});

describe("POST /api/projects/:slug/tasks", () => {
  const post = (app: ReturnType<typeof makeApp>, body: string) =>
    adminRequest(app, "/api/projects/shop/tasks", { method: "POST", body });

  it("creates the task and returns 201", async () => {
    const create = vi.fn(async () => ({ status: "created" as const, task: taskDetail }));
    const res = await post(makeApp({ ...asUser(member), createTask: create }), JSON.stringify({ title: "Checkout" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(taskDetail);
    expect(create).toHaveBeenCalledWith(member, "shop", { title: "Checkout" });
  });

  it.each([
    [{ status: "invalid", field: "body" }, { error: "invalid_body" }],
    [{ status: "invalid", field: "title" }, { error: "invalid_task_title" }],
    [{ status: "invalid", field: "description" }, { error: "invalid_task_description" }],
    [{ status: "invalid", field: "priority" }, { error: "invalid_task_priority" }],
    [{ status: "invalid", field: "stage" }, { error: "invalid_task_stage" }],
    [{ status: "invalid_assignee" }, { error: "invalid_assignee" }],
  ] as const)("maps %j to 400", async (result, body) => {
    const res = await post(makeApp({ ...asUser(member), createTask: async () => result }), "{}");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(body);
  });
});

describe("POST /api/projects/:slug/tasks/:key/take", () => {
  const take = (app: ReturnType<typeof makeApp>) =>
    adminRequest(app, "/api/projects/shop/tasks/RF-1/take", { method: "POST", body: "{}" });

  it("takes the task as the signed-in user", async () => {
    const takeTask = vi.fn(async () => ({ status: "ok" as const, task: taskDetail }));
    const res = await take(makeApp({ ...asUser(member), takeTask }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(taskDetail);
    expect(takeTask).toHaveBeenCalledWith(member, "shop", "RF-1");
  });

  it("accepts a request without a body", async () => {
    const takeTask = vi.fn(async () => ({ status: "ok" as const, task: taskDetail }));
    const app = makeApp({ ...asUser(member), takeTask });
    const res = await app.request("/api/projects/shop/tasks/RF-1/take", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=session-token`, origin: ORIGIN, "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
  });

  it.each([
    [{ status: "task_not_found" }, 404, { error: "task_not_found" }],
    [{ status: "task_taken" }, 409, { error: "task_taken" }],
    [{ status: "task_done" }, 409, { error: "task_done" }],
    [
      { status: "dependencies_pending", pendingDependencies: ["RF-2", "RF-3"] },
      409,
      { error: "dependencies_pending", pendingDependencies: ["RF-2", "RF-3"] },
    ],
  ] as const)("maps %j to %i", async (result, status, body) => {
    const res = await take(makeApp({ ...asUser(member), takeTask: async () => result }));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });
});

describe("POST /api/projects/:slug/tasks/:key/release", () => {
  const release = (app: ReturnType<typeof makeApp>) =>
    adminRequest(app, "/api/projects/shop/tasks/RF-1/release", { method: "POST", body: "{}" });

  it("releases the task", async () => {
    const releaseTask = vi.fn(async () => ({ status: "ok" as const, task: taskDetail }));
    const res = await release(makeApp({ ...asUser(admin), releaseTask }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(taskDetail);
    expect(releaseTask).toHaveBeenCalledWith(admin, "shop", "RF-1");
  });

  it.each([
    [{ status: "task_not_found" }, 404, { error: "task_not_found" }],
    [{ status: "task_not_assigned" }, 409, { error: "task_not_assigned" }],
  ] as const)("maps %j to %i", async (result, status, body) => {
    const res = await release(makeApp({ ...asUser(member), releaseTask: async () => result }));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });
});

describe("PATCH /api/projects/:slug/tasks/:key", () => {
  const patch = (app: ReturnType<typeof makeApp>, body: string) =>
    adminRequest(app, "/api/projects/shop/tasks/RF-1", { method: "PATCH", body });

  it("updates the task", async () => {
    const updateTask = vi.fn(async () => ({ status: "ok" as const, task: taskDetail }));
    const res = await patch(makeApp({ ...asUser(member), updateTask }), JSON.stringify({ status: "in_review" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(taskDetail);
    expect(updateTask).toHaveBeenCalledWith(member, "shop", "RF-1", { status: "in_review" });
  });

  it.each([
    [{ status: "invalid", field: "status" }, 400, { error: "invalid_task_status" }],
    [{ status: "empty_update" }, 400, { error: "empty_update" }],
    [{ status: "invalid_assignee" }, 400, { error: "invalid_assignee" }],
    [{ status: "task_not_found" }, 404, { error: "task_not_found" }],
    [
      { status: "dependencies_pending", pendingDependencies: ["RF-2"] },
      409,
      { error: "dependencies_pending", pendingDependencies: ["RF-2"] },
    ],
  ] as const)("maps %j to %i", async (result, status, body) => {
    const res = await patch(makeApp({ ...asUser(member), updateTask: async () => result }), "{}");
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });
});

describe("POST /api/projects/:slug/tasks/:key/dependencies", () => {
  const post = (app: ReturnType<typeof makeApp>, body: string) =>
    adminRequest(app, "/api/projects/shop/tasks/RF-1/dependencies", { method: "POST", body });

  it("adds the dependency and returns 201", async () => {
    const dependency = { key: "RF-2", title: "API", status: "todo" as const };
    const add = vi.fn(async () => ({ status: "created" as const, dependency }));
    const res = await post(makeApp({ ...asUser(member), addTaskDependency: add }), JSON.stringify({ dependsOnKey: "rf-2" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(dependency);
    expect(add).toHaveBeenCalledWith(member, "shop", "RF-1", "rf-2");
  });

  it("passes a missing key through as undefined for validation", async () => {
    const add = vi.fn(async () => ({ status: "invalid" as const, field: "dependsOnKey" as const }));
    const res = await post(makeApp({ ...asUser(member), addTaskDependency: add }), "null");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_task_key" });
    expect(add).toHaveBeenCalledWith(member, "shop", "RF-1", undefined);
  });

  it.each([
    [{ status: "self_dependency" }, 400, { error: "self_dependency" }],
    [{ status: "task_not_found" }, 404, { error: "task_not_found" }],
    [{ status: "dependency_exists" }, 409, { error: "dependency_exists" }],
    [{ status: "dependency_cycle" }, 409, { error: "dependency_cycle" }],
  ] as const)("maps %j to %i", async (result, status, body) => {
    const res = await post(makeApp({ ...asUser(member), addTaskDependency: async () => result }), "{}");
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });
});

describe("DELETE /api/projects/:slug/tasks/:key/dependencies/:dependsOnKey", () => {
  const remove = (app: ReturnType<typeof makeApp>) =>
    adminRequest(app, "/api/projects/shop/tasks/RF-1/dependencies/RF-2", { method: "DELETE" });

  it("removes the dependency and returns 204", async () => {
    const removeTaskDependency = vi.fn(async () => ({ status: "removed" as const }));
    const res = await remove(makeApp({ ...asUser(member), removeTaskDependency }));
    expect(res.status).toBe(204);
    expect(removeTaskDependency).toHaveBeenCalledWith(member, "shop", "RF-1", "RF-2");
  });

  it.each([[{ status: "task_not_found" }], [{ status: "dependency_not_found" }]] as const)(
    "maps %j to 404",
    async (result) => {
      const res = await remove(makeApp({ ...asUser(member), removeTaskDependency: async () => result }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: result.status });
    },
  );
});

describe("DELETE /api/projects/:slug/tasks/:key", () => {
  const remove = (app: ReturnType<typeof makeApp>) =>
    adminRequest(app, "/api/projects/shop/tasks/RF-7", { method: "DELETE" });

  it("deletes the task and returns 204 without a JSON content type", async () => {
    const deleteTask = vi.fn(async () => ({ status: "deleted" as const }));
    const res = await adminRequest(makeApp({ ...asUser(member), deleteTask }), "/api/projects/shop/tasks/RF-7", {
      method: "DELETE",
      contentType: null,
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(deleteTask).toHaveBeenCalledWith(member, "shop", "RF-7");
  });

  it("maps task_not_found to 404", async () => {
    const res = await remove(makeApp({ ...asUser(member), deleteTask: async () => ({ status: "task_not_found" }) }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "task_not_found" });
  });
});

describe("POST /discord/interactions", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const discordPublicKey = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  const timestamp = "1700000000";
  const reply: DiscordInteractionResponse = { type: 4, data: { content: "hi", flags: 64, allowed_mentions: { parse: [] } } };

  const deliver = (
    app: ReturnType<typeof makeApp>,
    body: string,
    { signature, headers = {} }: { signature?: string | null; headers?: Record<string, string> } = {},
  ) => {
    const all: Record<string, string> = { "content-type": "application/json", ...headers };
    const sig = signature === undefined ? sign(null, Buffer.from(timestamp + body), privateKey).toString("hex") : signature;
    if (sig !== null) {
      all["x-signature-ed25519"] = sig;
      all["x-signature-timestamp"] = timestamp;
    }
    return app.request("/discord/interactions", { method: "POST", headers: all, body });
  };

  it("is not found when DISCORD_PUBLIC_KEY is not configured", async () => {
    const handle = vi.fn();
    const res = await deliver(makeApp({ handleDiscordInteraction: handle }), JSON.stringify({ type: 1 }));
    expect(res.status).toBe(404);
    expect(handle).not.toHaveBeenCalled();
  });

  it("returns 401 for missing or invalid signatures", async () => {
    const handle = vi.fn();
    const app = makeApp({ discordPublicKey, handleDiscordInteraction: handle });
    const body = JSON.stringify({ type: 1 });
    expect((await deliver(app, body, { signature: null })).status).toBe(401);
    expect((await deliver(app, body, { signature: "0".repeat(128) })).status).toBe(401);
    const other = generateKeyPairSync("ed25519").privateKey;
    const forged = sign(null, Buffer.from(timestamp + body), other).toString("hex");
    expect((await deliver(app, body, { signature: forged })).status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });

  it("hands the verified, parsed interaction to the handler and returns its response", async () => {
    const handle = vi.fn(async () => reply);
    const app = makeApp({ discordPublicKey, handleDiscordInteraction: handle });
    const interaction = { type: 2, channel_id: "1", data: { name: "tasks" } };

    const res = await deliver(app, JSON.stringify(interaction));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual(reply);
    expect(handle).toHaveBeenCalledWith(interaction);
  });

  it("is exempt from the cookie-session Origin and JSON guards", async () => {
    const app = makeApp({ discordPublicKey, handleDiscordInteraction: async () => reply });
    const body = JSON.stringify({ type: 1 });
    const foreign = await deliver(app, body, { headers: { origin: "https://evil.example.com", "content-type": "text/plain" } });
    expect(foreign.status).toBe(200);
    expect((await deliver(app, body)).status).toBe(200);
  });

  it("returns 400 for a signed body that is not JSON", async () => {
    const handle = vi.fn();
    const app = makeApp({ discordPublicKey, handleDiscordInteraction: handle });
    expect((await deliver(app, "{nope")).status).toBe(400);
    expect(handle).not.toHaveBeenCalled();
  });

  it("returns 413 for bodies over 64 KB without verifying or handling them", async () => {
    const handle = vi.fn();
    const app = makeApp({ discordPublicKey, handleDiscordInteraction: handle });
    const res = await deliver(app, JSON.stringify({ type: 2, padding: "x".repeat(64 * 1024) }));
    expect(res.status).toBe(413);
    expect(handle).not.toHaveBeenCalled();
  });

  it("logs a failing handler and answers with an ephemeral error instead of a 5xx", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const app = makeApp({
        discordPublicKey,
        handleDiscordInteraction: async () => {
          throw new Error("database down");
        },
      });
      const res = await deliver(app, JSON.stringify({ type: 2 }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        type: 4,
        data: {
          content: "Something went wrong. Please try again in a moment.",
          flags: 64,
          allowed_mentions: { parse: [] },
        },
      });
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it("is routed before the SPA fallback", async () => {
    const webDistDir = mkdtempSync(join(tmpdir(), "web-dist-"));
    writeFileSync(join(webDistDir, "index.html"), "<!doctype html><title>spa</title>");
    try {
      const app = makeApp({ webDistDir, discordPublicKey, handleDiscordInteraction: async () => ({ type: 1 }) });
      const res = await deliver(app, JSON.stringify({ type: 1 }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ type: 1 });
    } finally {
      rmSync(webDistDir, { recursive: true, force: true });
    }
  });
});

const API_TOKEN = `ttk_${"t".repeat(43)}`;
const tokenCaller: ApiTokenCaller = {
  kind: "api_token",
  tokenId: 5,
  projectId: 3,
  project: { id: 3, slug: "shop", name: "Shop", taskKeyPrefix: "RF" },
};
const withToken = (caller: ApiTokenCaller = tokenCaller) => ({
  authenticateApiToken: vi.fn(async (token: string) => (token === API_TOKEN ? caller : undefined)),
});

/** Request helper sending `Authorization: Bearer <token>` and, optionally, the session cookie too. */
const bearerRequest = (
  app: ReturnType<typeof makeApp>,
  path: string,
  {
    method = "GET",
    body,
    authorization = `Bearer ${API_TOKEN}`,
    cookie = false,
  }: { method?: string; body?: string; authorization?: string; cookie?: boolean } = {},
) => {
  const headers: Record<string, string> = { authorization };
  if (cookie) headers.cookie = `${SESSION_COOKIE}=session-token`;
  if (method !== "GET") headers.origin = ORIGIN;
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, { method, headers, body });
};

const tokenReadRoutes = [
  "/api/projects",
  "/api/projects/shop/tasks",
  "/api/projects/shop/tasks/RF-1",
  "/api/projects/shop/participants",
] as const;

describe("API token (bearer) authentication", () => {
  it("lists only the token's project on GET /api/projects", async () => {
    const find = vi.fn();
    const list = vi.fn();
    const app = makeApp({ ...withToken(), findSessionUser: find, listVisibleProjects: list });

    const res = await bearerRequest(app, "/api/projects");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([tokenCaller.project]);
    expect(list).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });

  it("reads the board, a task and the participants through the task use cases", async () => {
    const listTasks = vi.fn(async () => ({ status: "ok" as const, tasks: [{ ...boardTask, canTake: false }] }));
    const getTask = vi.fn(async () => ({ status: "ok" as const, task: taskDetail }));
    const participants = [{ login: "mona", name: null, avatarUrl: null }];
    const listParticipants = vi.fn(async () => ({ status: "ok" as const, participants }));
    const app = makeApp({ ...withToken(), listTasks, getTask, listParticipants });

    const board = await bearerRequest(app, "/api/projects/shop/tasks");
    expect(board.status).toBe(200);
    expect(await board.json()).toEqual([{ ...boardTask, canTake: false }]);
    expect(listTasks).toHaveBeenCalledWith(tokenCaller, "shop");

    const task = await bearerRequest(app, "/api/projects/shop/tasks/rf-1");
    expect(task.status).toBe(200);
    expect(getTask).toHaveBeenCalledWith(tokenCaller, "shop", "rf-1");

    const people = await bearerRequest(app, "/api/projects/shop/participants");
    expect(await people.json()).toEqual(participants);
    expect(listParticipants).toHaveBeenCalledWith(tokenCaller, "shop");
  });

  it("maps another project (project_not_found from the use case) to 404", async () => {
    const res = await bearerRequest(makeApp(withToken()), "/api/projects/blog/tasks");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "project_not_found" });
  });

  it("uses the token, not the cookie session, when both are sent (least privilege)", async () => {
    const find = vi.fn(async () => admin);
    const listTasks = vi.fn(async () => ({ status: "ok" as const, tasks: [] }));
    const app = makeApp({ ...withToken(), findSessionUser: find, listTasks });

    const res = await bearerRequest(app, "/api/projects/shop/tasks", { cookie: true });

    expect(res.status).toBe(200);
    expect(listTasks).toHaveBeenCalledWith(tokenCaller, "shop");
    expect(find).not.toHaveBeenCalled();
  });

  it.each(
    tokenReadRoutes.flatMap((path) =>
      [`Bearer ttk_${"z".repeat(43)}`, "Bearer", "Bearer ", `Basic ${API_TOKEN}`, API_TOKEN, "Bearer a b"].map(
        (authorization) => [path, authorization] as const,
      ),
    ),
  )("GET %s returns a uniform 401 for the authorization %j", async (path, authorization) => {
    const spies = taskSpies();
    const app = makeApp({ ...withToken(), ...spies, ...asUser(admin) });

    const res = await bearerRequest(app, path, { authorization, cookie: true });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_token" });
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });

  it("returns the same 401 when the use case rejects a revoked or expired token", async () => {
    const app = makeApp({ authenticateApiToken: async () => undefined });
    const res = await bearerRequest(app, "/api/projects/shop/tasks");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_token" });
  });

  it.each([
    ...taskMutations,
    ["POST", "/api/admin/members", JSON.stringify({ githubLogin: "mona" })],
    ["DELETE", "/api/admin/projects/shop", undefined],
    ["POST", "/api/admin/projects/shop/tokens", JSON.stringify({ name: "x" })],
    ["DELETE", "/api/admin/projects/shop/tokens/1", undefined],
    ["POST", "/auth/logout", undefined],
    ["DELETE", "/auth/discord", undefined],
  ] as const)("%s %s returns 403 with a bearer token, even with an admin session", async (method, path, body) => {
    const spies = { ...taskSpies(), ...adminSpies(), endSession: vi.fn(), unlinkDiscordAccount: vi.fn() };
    const auth = withToken();
    const app = makeApp({ ...auth, ...spies, ...asUser(admin) });

    const res = await bearerRequest(app, path, { method, body, cookie: true });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "token_not_allowed" });
    expect(auth.authenticateApiToken).not.toHaveBeenCalled();
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    "/api/admin/members",
    "/api/admin/projects",
    "/api/admin/projects/shop",
    "/api/admin/projects/shop/tokens",
  ])("GET %s returns 403 with a bearer token, with or without a session", async (path) => {
    const spies = adminSpies();
    for (const cookie of [false, true]) {
      const app = makeApp({ ...withToken(), ...spies, ...asUser(admin) });
      const res = await bearerRequest(app, path, { cookie });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "token_not_allowed" });
    }
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });

  it("rate limits each token and answers 429 with Retry-After", async () => {
    let clock = 0;
    const limiter = createInMemoryRateLimiter({ limit: 2, windowMs: 60_000, now: () => clock });
    const listTasks = vi.fn(async () => ({ status: "ok" as const, tasks: [] }));
    const app = makeApp({
      ...withToken(),
      listTasks,
      rateLimitApiToken: (tokenId) => limiter.hit(String(tokenId)),
    });

    expect((await bearerRequest(app, "/api/projects/shop/tasks")).status).toBe(200);
    expect((await bearerRequest(app, "/api/projects")).status).toBe(200);
    clock = 15_000;
    const limited = await bearerRequest(app, "/api/projects/shop/tasks");

    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("45");
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect(listTasks).toHaveBeenCalledTimes(1);

    clock = 60_000;
    expect((await bearerRequest(app, "/api/projects/shop/tasks")).status).toBe(200);
  });

  it("never writes the token or the Authorization header to the logs", async () => {
    const methods = ["log", "info", "warn", "error", "debug"] as const;
    const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      const app = makeApp({
        ...withToken(),
        listTasks: async () => {
          throw new Error("db down");
        },
      });
      await bearerRequest(app, "/api/projects/shop/tasks");
      await bearerRequest(app, "/api/projects/shop/tasks", { authorization: `Bearer ${API_TOKEN}x` });
      await bearerRequest(app, "/api/projects/shop/tasks", { method: "POST", body: "{}" });
      await bearerRequest(app, "/api/admin/members");
      await bearerRequest(app, "/api/projects");

      const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls), (_key, value: unknown) =>
        value instanceof Error ? `${value.message} ${value.stack}` : value,
      );
      expect(logged).not.toContain("ttk_");
      expect(logged.toLowerCase()).not.toContain("bearer");
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("serves the OpenAPI document publicly", async () => {
    const res = await makeApp().request("/api/openapi.json");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ openapi: "3.1.0" });
  });
});

const tokenView: ApiTokenView = {
  id: 1,
  name: "VPS agent",
  prefix: "abcdefgh",
  permission: "read",
  createdAt: new Date("2026-05-01T12:00:00Z"),
  createdBy: "octocat",
  lastUsedAt: null,
  expiresAt: new Date("2026-07-30T12:00:00Z"),
  revokedAt: null,
  status: "active",
};
const tokenViewJson = {
  ...tokenView,
  createdAt: "2026-05-01T12:00:00.000Z",
  expiresAt: "2026-07-30T12:00:00.000Z",
};

describe("GET /api/admin/projects/:slug/tokens", () => {
  it("lists the project's tokens", async () => {
    const list = vi.fn(async () => ({ status: "ok" as const, tokens: [tokenView] }));
    const res = await adminRequest(makeApp({ ...asUser(admin), listApiTokens: list }), "/api/admin/projects/Shop/tokens");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([tokenViewJson]);
    expect(list).toHaveBeenCalledWith("Shop");
  });

  it("returns 404 for an unknown project", async () => {
    const res = await adminRequest(makeApp(asUser(admin)), "/api/admin/projects/ghost/tokens");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "project_not_found" });
  });
});

describe("POST /api/admin/projects/:slug/tokens", () => {
  const post = (app: ReturnType<typeof makeApp>, body: string) =>
    adminRequest(app, "/api/admin/projects/shop/tokens", { method: "POST", body });

  it("creates the token and returns its secret once, uncached", async () => {
    const create = vi.fn(async () => ({ status: "created" as const, token: API_TOKEN, apiToken: tokenView }));
    const res = await post(makeApp({ ...asUser(admin), createApiToken: create }), JSON.stringify({ name: "VPS agent" }));

    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ token: API_TOKEN, ...tokenViewJson });
    expect(create).toHaveBeenCalledWith("shop", { name: "VPS agent" }, admin);
  });

  it.each([
    ["body", "invalid_body"],
    ["name", "invalid_token_name"],
    ["expiresInDays", "invalid_token_expiry"],
    ["permission", "invalid_token_permission"],
  ] as const)("maps an invalid %s to 400 %s", async (field, error) => {
    const app = makeApp({ ...asUser(admin), createApiToken: async () => ({ status: "invalid", field }) });
    const res = await post(app, "{}");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
  });

  it("returns 404 for an unknown project", async () => {
    const res = await post(makeApp(asUser(admin)), JSON.stringify({ name: "x" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "project_not_found" });
  });

  it("returns 400 for malformed JSON", async () => {
    const create = vi.fn();
    const res = await post(makeApp({ ...asUser(admin), createApiToken: create }), "{nope");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "malformed_json" });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/projects/:slug/tokens/:id", () => {
  const revoke = (app: ReturnType<typeof makeApp>) =>
    adminRequest(app, "/api/admin/projects/shop/tokens/7", { method: "DELETE" });

  it("revokes the token and returns 204", async () => {
    const spy = vi.fn(async () => ({ status: "revoked" as const }));
    const res = await revoke(makeApp({ ...asUser(admin), revokeApiToken: spy }));
    expect(res.status).toBe(204);
    expect(spy).toHaveBeenCalledWith("shop", "7");
  });

  it.each(["project_not_found", "token_not_found"] as const)("maps %s to 404", async (status) => {
    const res = await revoke(makeApp({ ...asUser(admin), revokeApiToken: async () => ({ status }) }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: status });
  });
});
