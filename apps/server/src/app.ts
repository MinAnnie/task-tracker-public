import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type {
  ApiTokenCaller,
  CreateApiTokenResult,
  ListApiTokensResult,
  RevokeApiTokenResult,
  ApiTokenField,
} from "./application/api-tokens.ts";
import type { DiscordAccount, SessionUser } from "./application/auth-store.ts";
import type { CompleteGithubLoginResult } from "./application/complete-github-login.ts";
import type { CompleteDiscordLinkResult } from "./application/discord-link.ts";
import type {
  AddMemberResult,
  MembersOverview,
  RemoveMemberResult,
} from "./application/members.ts";
import type { ProjectRef, ProjectSummary } from "./application/project-store.ts";
import type {
  AddProjectMemberResult,
  AddProjectRepositoryResult,
  CreateProjectResult,
  DeleteProjectResult,
  GetProjectResult,
  ProjectField,
  RemoveProjectMemberResult,
  RemoveProjectRepositoryResult,
  UpdateProjectResult,
} from "./application/projects.ts";
import type { AuthenticatedUser } from "./application/sessions.ts";
import type {
  AddTaskDependencyResult,
  CreateTaskResult,
  DeleteTaskResult,
  GetTaskResult,
  ListParticipantsResult,
  ListTasksResult,
  ReleaseTaskResult,
  RemoveTaskDependencyResult,
  TakeTaskResult,
  TaskField,
  TaskViewer,
  UpdateTaskResult,
} from "./application/tasks.ts";
import type {
  PullRequestEventInput,
  PullRequestEventResult,
} from "./application/handle-pull-request-event.ts";
import type { RateLimitDecision } from "./infrastructure/in-memory-rate-limiter.ts";
import { openApiDocument } from "./openapi.ts";
import { parsePullRequestPayload } from "./webhooks/github/parse-pull-request-payload.ts";
import { verifyGithubSignature } from "./webhooks/github/verify-signature.ts";
import type { DiscordInteractionResponse } from "./webhooks/discord/handle-interaction.ts";
import { verifyDiscordSignature } from "./webhooks/discord/verify-signature.ts";

export interface AppDeps {
  /** Resolves when the database answers a trivial query; rejects otherwise. */
  checkDatabase: () => Promise<void>;
  /** Absolute path to the built web app. When set, it is served at "/". */
  webDistDir?: string;
  /** Secret used to verify `X-Hub-Signature-256` on GitHub webhook deliveries. */
  githubWebhookSecret: string;
  /** Use case applying a verified, parsed GitHub `pull_request` event. */
  handlePullRequestEvent: (input: PullRequestEventInput) => Promise<PullRequestEventResult>;
  /** Client id of the GitHub OAuth app used for login. */
  githubClientId: string;
  /** Public origin of the app; the OAuth callback URL and cookie `Secure` flag derive from it. */
  appBaseUrl: string;
  /** Use case trading a GitHub OAuth `code` for a session. */
  completeGithubLogin: (code: string) => Promise<CompleteGithubLoginResult>;
  /** Resolves the user and role behind a session token, or `undefined` when absent, expired or revoked. */
  findSessionUser: (sessionToken: string) => Promise<AuthenticatedUser | undefined>;
  /** Deletes the session behind a token. */
  endSession: (sessionToken: string) => Promise<void>;
  /** Lists configured admins and database members. */
  listMembers: () => Promise<MembersOverview>;
  /** Grants the member role; `githubLogin` is the untrusted value from the request body. */
  addMember: (input: { githubLogin: unknown; actor: SessionUser }) => Promise<AddMemberResult>;
  /** Revokes a member and their sessions. */
  removeMember: (githubLogin: string) => Promise<RemoveMemberResult>;
  /** Lists every project with its counts (admin view). */
  listProjects: () => Promise<ProjectSummary[]>;
  /** Lists the projects the signed-in user may see. */
  listVisibleProjects: (user: AuthenticatedUser) => Promise<ProjectRef[]>;
  /** Creates a project; `body` is the untrusted parsed request body. */
  createProject: (body: unknown) => Promise<CreateProjectResult>;
  getProject: (slug: string) => Promise<GetProjectResult>;
  /** Partially updates a project; `body` is the untrusted parsed request body. */
  updateProject: (slug: string, body: unknown) => Promise<UpdateProjectResult>;
  deleteProject: (slug: string) => Promise<DeleteProjectResult>;
  /** Links a repository; `fullName` is the untrusted value from the request body. */
  addProjectRepository: (slug: string, fullName: unknown) => Promise<AddProjectRepositoryResult>;
  removeProjectRepository: (slug: string, fullName: string) => Promise<RemoveProjectRepositoryResult>;
  /** Adds an app member to a project; `githubLogin` is the untrusted value from the request body. */
  addProjectMember: (slug: string, githubLogin: unknown) => Promise<AddProjectMemberResult>;
  /** Removes a member from a project and unassigns their open tasks there. */
  removeProjectMember: (slug: string, githubLogin: string) => Promise<RemoveProjectMemberResult>;
  /** The board of a project the user (or API token) participates in. */
  listTasks: (viewer: TaskViewer, slug: string) => Promise<ListTasksResult>;
  /** People who can be assigned tasks in a project the user (or API token) participates in. */
  listParticipants: (viewer: TaskViewer, slug: string) => Promise<ListParticipantsResult>;
  getTask: (viewer: TaskViewer, slug: string, key: string) => Promise<GetTaskResult>;
  /** Creates a task; `body` is the untrusted parsed request body. */
  createTask: (user: AuthenticatedUser, slug: string, body: unknown) => Promise<CreateTaskResult>;
  takeTask: (user: AuthenticatedUser, slug: string, key: string) => Promise<TakeTaskResult>;
  releaseTask: (user: AuthenticatedUser, slug: string, key: string) => Promise<ReleaseTaskResult>;
  /** Partially updates a task; `body` is the untrusted parsed request body. */
  updateTask: (user: AuthenticatedUser, slug: string, key: string, body: unknown) => Promise<UpdateTaskResult>;
  /** Adds a dependency; `dependsOnKey` is the untrusted value from the request body. */
  addTaskDependency: (
    user: AuthenticatedUser,
    slug: string,
    key: string,
    dependsOnKey: unknown,
  ) => Promise<AddTaskDependencyResult>;
  removeTaskDependency: (
    user: AuthenticatedUser,
    slug: string,
    key: string,
    dependsOnKey: string,
  ) => Promise<RemoveTaskDependencyResult>;
  /** Deletes a task for good (admins only). */
  deleteTask: (user: AuthenticatedUser, slug: string, key: string) => Promise<DeleteTaskResult>;
  /** Client id (application id) of the Discord OAuth2 app; `undefined` disables account linking. */
  discordApplicationId: string | undefined;
  /** Use case linking the Discord account behind an OAuth `code` to a user. */
  completeDiscordLink: (userId: number, code: string) => Promise<CompleteDiscordLinkResult>;
  findDiscordAccount: (userId: number) => Promise<DiscordAccount | null>;
  unlinkDiscordAccount: (userId: number) => Promise<void>;
  /** Hex Ed25519 key verifying Discord interactions; `undefined` disables slash commands. */
  discordPublicKey: string | undefined;
  /** Answers a verified, parsed Discord interaction (PING, slash command or autocomplete). */
  handleDiscordInteraction: (interaction: unknown) => Promise<DiscordInteractionResponse>;
  /**
   * Resolves a bearer token to its read-only, project-scoped caller; `undefined` when it is
   * malformed, unknown, revoked or expired. Implementations must never log the token.
   */
  authenticateApiToken: (token: string) => Promise<ApiTokenCaller | undefined>;
  /** Counts one request of an authenticated API token against its rate limit. */
  rateLimitApiToken: (tokenId: number) => RateLimitDecision;
  listApiTokens: (slug: string) => Promise<ListApiTokensResult>;
  /** Creates a token; `body` is the untrusted parsed request body. The secret is returned once. */
  createApiToken: (slug: string, body: unknown, actor: AuthenticatedUser) => Promise<CreateApiTokenResult>;
  /** Revokes a token; `tokenId` is the untrusted path segment. */
  revokeApiToken: (slug: string, tokenId: string) => Promise<RevokeApiTokenResult>;
}

/** Every unsuccessful outcome of a task use case. */
type TaskFailure = Exclude<
  | ListTasksResult
  | ListParticipantsResult
  | GetTaskResult
  | CreateTaskResult
  | TakeTaskResult
  | ReleaseTaskResult
  | UpdateTaskResult
  | AddTaskDependencyResult
  | RemoveTaskDependencyResult
  | DeleteTaskResult,
  { status: "ok" | "created" | "removed" | "deleted" }
>;

/** Who reads a token-readable route: the signed-in user or an API token. */
type Viewer = AuthenticatedUser | ApiTokenCaller;

type AdminEnv = { Variables: { user: AuthenticatedUser; viewer: Viewer } };

const INVALID_API_TOKEN_FIELD_ERRORS: Record<ApiTokenField, string> = {
  body: "invalid_body",
  name: "invalid_token_name",
  expiresInDays: "invalid_token_expiry",
  permission: "invalid_token_permission",
};

/** `Authorization: Bearer <token>` with exactly one credential; anything else is not a bearer token. */
const BEARER_AUTHORIZATION = /^Bearer +(\S+) *$/i;

const INVALID_FIELD_ERRORS: Record<ProjectField, string> = {
  body: "invalid_body",
  name: "invalid_project_name",
  slug: "invalid_project_slug",
  taskKeyPrefix: "invalid_task_key_prefix",
  discordChannelId: "invalid_discord_channel_id",
};

const INVALID_TASK_FIELD_ERRORS: Record<TaskField, string> = {
  body: "invalid_body",
  title: "invalid_task_title",
  description: "invalid_task_description",
  priority: "invalid_task_priority",
  stage: "invalid_task_stage",
  status: "invalid_task_status",
  dependsOnKey: "invalid_task_key",
};

const TASK_FAILURE_STATUS = {
  project_not_found: 404,
  task_not_found: 404,
  dependency_not_found: 404,
  forbidden: 403,
  invalid_assignee: 400,
  empty_update: 400,
  self_dependency: 400,
  task_taken: 409,
  task_done: 409,
  task_not_assigned: 409,
  dependency_exists: 409,
  dependency_cycle: 409,
} as const satisfies Record<Exclude<TaskFailure["status"], "invalid" | "dependencies_pending">, number>;

/** Renders a failed task use case as its error response. */
function taskFailure(c: Context, failure: TaskFailure) {
  switch (failure.status) {
    case "invalid":
      return c.json({ error: INVALID_TASK_FIELD_ERRORS[failure.field] }, 400);
    case "dependencies_pending":
      return c.json({ error: failure.status, pendingDependencies: failure.pendingDependencies }, 409);
    default:
      return c.json({ error: failure.status }, TASK_FAILURE_STATUS[failure.status]);
  }
}

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const SESSION_COOKIE = "session";
const STATE_COOKIE = "oauth_state";
const STATE_COOKIE_PATH = "/auth/github";
const STATE_TTL_SECONDS = 10 * 60;
/** Interactions are small JSON documents; anything larger is not from Discord. */
const DISCORD_INTERACTION_MAX_BYTES = 64 * 1024;
const DISCORD_INTERACTION_FAILED: DiscordInteractionResponse = {
  type: 4,
  data: {
    content: "Something went wrong. Please try again in a moment.",
    flags: 64,
    allowed_mentions: { parse: [] },
  },
};
const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const DISCORD_STATE_COOKIE = "discord_oauth_state";
const DISCORD_STATE_COOKIE_PATH = "/auth/discord";

/** Outcome of the Discord linking flow, handed to the web app as `/?discord=<outcome>`. */
type DiscordLinkOutcome = "linked" | "already_linked" | "cancelled" | "failed";

/** Constant-time string comparison that never throws on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Whether a `Content-Type` header declares JSON, ignoring parameters such as charset. */
function isJsonContentType(header: string | undefined): boolean {
  return header?.split(";")[0]?.trim().toLowerCase() === "application/json";
}

/** Parses the JSON request body; `{ ok: false }` when it is malformed. */
async function readJsonBody(c: Context): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

/** Reads `key` from a parsed body, or `undefined` when the body is not an object or lacks it. */
function bodyField(body: unknown, key: string): unknown {
  return typeof body === "object" && body !== null && key in body
    ? (body as Record<string, unknown>)[key]
    : undefined;
}

export function createApp({
  checkDatabase,
  webDistDir,
  githubWebhookSecret,
  handlePullRequestEvent,
  githubClientId,
  appBaseUrl,
  completeGithubLogin,
  findSessionUser,
  endSession,
  listMembers,
  addMember,
  removeMember,
  listProjects,
  listVisibleProjects,
  createProject,
  getProject,
  updateProject,
  deleteProject,
  addProjectRepository,
  removeProjectRepository,
  addProjectMember,
  removeProjectMember,
  listTasks,
  listParticipants,
  getTask,
  createTask,
  takeTask,
  releaseTask,
  updateTask,
  addTaskDependency,
  removeTaskDependency,
  deleteTask,
  discordApplicationId,
  completeDiscordLink,
  findDiscordAccount,
  unlinkDiscordAccount,
  discordPublicKey,
  handleDiscordInteraction,
  authenticateApiToken,
  rateLimitApiToken,
  listApiTokens,
  createApiToken,
  revokeApiToken,
}: AppDeps): Hono {
  const app = new Hono();
  const callbackUrl = new URL("/auth/github/callback", appBaseUrl).toString();
  const secure = new URL(appBaseUrl).protocol === "https:";
  const appOrigin = new URL(appBaseUrl).origin;
  const discordCallbackUrl = new URL("/auth/discord/callback", appBaseUrl).toString();

  /** The user behind the session cookie, clearing a stale cookie; `undefined` when signed out. */
  const sessionUser = async (c: Context): Promise<AuthenticatedUser | undefined> => {
    const token = getCookie(c, SESSION_COOKIE);
    const user = token ? await findSessionUser(token) : undefined;
    if (user === undefined && token) deleteCookie(c, SESSION_COOKIE, { path: "/", secure });
    return user;
  };

  /**
   * 401 without a valid session (clearing a stale cookie); exposes the user as `user`.
   * Cookie-only: a request carrying an `Authorization` header is refused, so an API
   * token can never reach these routes, not even next to a valid session.
   */
  const requireUser = createMiddleware<AdminEnv>(async (c, next) => {
    if (c.req.header("authorization") !== undefined) return c.json({ error: "token_not_allowed" }, 403);
    const user = await sessionUser(c);
    if (user === undefined) return c.json({ error: "unauthenticated" }, 401);
    c.set("user", user);
    await next();
  });

  /** 403 for signed-in users who are not admins; runs after {@link requireUser}. */
  const requireAdminRole = createMiddleware<AdminEnv>(async (c, next) => {
    if (c.get("user").role !== "admin") return c.json({ error: "forbidden" }, 403);
    await next();
  });

  /**
   * For the read routes open to API tokens. With an `Authorization` header the request is
   * authenticated by the token alone, even when a session cookie is also sent (least
   * privilege: the narrower credential wins); otherwise by the session cookie. Every
   * token failure answers the same 401, and the token is never logged.
   */
  const requireViewer = createMiddleware<AdminEnv>(async (c, next) => {
    const authorization = c.req.header("authorization");
    if (authorization === undefined) {
      const user = await sessionUser(c);
      if (user === undefined) return c.json({ error: "unauthenticated" }, 401);
      c.set("viewer", user);
      return next();
    }

    const token = BEARER_AUTHORIZATION.exec(authorization)?.[1];
    const caller = token === undefined ? undefined : await authenticateApiToken(token);
    if (caller === undefined) {
      c.header("WWW-Authenticate", "Bearer");
      return c.json({ error: "invalid_token" }, 401);
    }
    const limit = rateLimitApiToken(caller.tokenId);
    if (!limit.allowed) {
      c.header("Retry-After", String(limit.retryAfterSeconds));
      return c.json({ error: "rate_limited" }, 429);
    }
    c.set("viewer", caller);
    await next();
  });

  /**
   * A bearer token never elevates: any request other than GET/HEAD that carries an
   * `Authorization` header is refused before authentication, even with a valid session.
   */
  const refuseTokenWrites = createMiddleware(async (c, next) => {
    const method = c.req.method;
    if (c.req.header("authorization") !== undefined && method !== "GET" && method !== "HEAD") {
      return c.json({ error: "token_not_allowed" }, 403);
    }
    await next();
  });
  app.use("/api/*", refuseTokenWrites);
  app.use("/auth/*", refuseTokenWrites);

  /**
   * CSRF defense for cookie-authenticated mutations. SameSite=Lax already keeps the
   * session cookie off cross-site POST/DELETE; on top of that the browser-set
   * `Origin` must be the app itself, and JSON bodies must be declared as such
   * (cross-site HTML forms cannot send `application/json`).
   */
  const requireSameOriginJson = createMiddleware<AdminEnv>(async (c, next) => {
    const method = c.req.method;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
    if (c.req.header("origin") !== appOrigin) return c.json({ error: "invalid_origin" }, 403);
    if ((method === "POST" || method === "PATCH") && !isJsonContentType(c.req.header("content-type"))) {
      return c.json({ error: "unsupported_media_type" }, 415);
    }
    await next();
  });

  app.get("/health", async (c) => {
    try {
      await checkDatabase();
      return c.json({ status: "ok", database: "ok" });
    } catch (error) {
      console.error("Health check failed:", error);
      return c.json({ status: "error", database: "unreachable" }, 503);
    }
  });

  app.post("/webhooks/github", async (c) => {
    // The signature covers the exact raw bytes, so read the body before parsing it.
    const rawBody = await c.req.text();
    if (!verifyGithubSignature(githubWebhookSecret, rawBody, c.req.header("x-hub-signature-256"))) {
      return c.json({ error: "invalid_signature" }, 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "malformed_json" }, 400);
    }

    if (c.req.header("x-github-event") !== "pull_request") {
      return c.json({ status: "ignored", reason: "unsupported_event" }, 202);
    }

    const input = parsePullRequestPayload(payload);
    if (input === undefined) return c.json({ error: "invalid_payload" }, 400);

    try {
      const result = await handlePullRequestEvent(input);
      return c.json(result, result.status === "processed" ? 200 : 202);
    } catch (error) {
      console.error("GitHub pull_request webhook failed:", error);
      return c.json({ error: "internal_error" }, 500);
    }
  });

  // Discord sends no cookies or Origin; the Ed25519 signature is the only authentication,
  // so this route deliberately sits outside the cookie-session CSRF guards.
  app.post(
    "/discord/interactions",
    bodyLimit({
      maxSize: DISCORD_INTERACTION_MAX_BYTES,
      onError: (c) => c.json({ error: "payload_too_large" }, 413),
    }),
    async (c) => {
      if (discordPublicKey === undefined) return c.json({ error: "not_found" }, 404);
      // The signature covers the exact raw bytes, so read the body before parsing it.
      const rawBody = await c.req.text();
      const signature = c.req.header("x-signature-ed25519");
      const timestamp = c.req.header("x-signature-timestamp");
      if (!verifyDiscordSignature(discordPublicKey, rawBody, signature, timestamp)) {
        return c.json({ error: "invalid_signature" }, 401);
      }

      let interaction: unknown;
      try {
        interaction = JSON.parse(rawBody);
      } catch {
        return c.json({ error: "malformed_json" }, 400);
      }

      try {
        return c.json(await handleDiscordInteraction(interaction));
      } catch (error) {
        console.error("Discord interaction failed:", error);
        return c.json(DISCORD_INTERACTION_FAILED);
      }
    },
  );

  app.get("/auth/github", (c) => {
    const state = randomBytes(32).toString("base64url");
    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "Lax",
      secure,
      path: STATE_COOKIE_PATH,
      maxAge: STATE_TTL_SECONDS,
    });
    const authorize = new URL(GITHUB_AUTHORIZE_URL);
    authorize.searchParams.set("client_id", githubClientId);
    authorize.searchParams.set("redirect_uri", callbackUrl);
    authorize.searchParams.set("state", state);
    return c.redirect(authorize.toString(), 302);
  });

  app.get("/auth/github/callback", async (c) => {
    const expectedState = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: STATE_COOKIE_PATH, secure });

    const state = c.req.query("state");
    if (!expectedState || !state || !safeEqual(state, expectedState)) {
      return c.json({ error: "invalid_state" }, 400);
    }

    const code = c.req.query("code");
    if (!code) return c.json({ error: "missing_code" }, 400);

    let result: CompleteGithubLoginResult;
    try {
      result = await completeGithubLogin(code);
    } catch (error) {
      console.error("GitHub login failed:", error);
      return c.json({ error: "login_failed" }, 502);
    }
    if (result.status === "forbidden") {
      // A browser lands here from GitHub: send it back to the web app's login screen,
      // which explains that the account has no access yet.
      const denied = new URLSearchParams({ error: "not_allowed", login: result.login });
      return c.redirect(`/login?${denied.toString()}`, 302);
    }

    setCookie(c, SESSION_COOKIE, result.sessionToken, {
      httpOnly: true,
      sameSite: "Lax",
      secure,
      path: "/",
      maxAge: Math.max(0, Math.floor((result.expiresAt.getTime() - Date.now()) / 1000)),
    });
    return c.redirect("/", 302);
  });

  app.get("/auth/me", async (c) => {
    const user = await sessionUser(c);
    if (user === undefined) return c.json({ error: "unauthenticated" }, 401);
    return c.json({
      id: user.id,
      githubLogin: user.githubLogin,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: user.role,
      discord: await findDiscordAccount(user.id),
      discordLinkingEnabled: discordApplicationId !== undefined,
    });
  });

  app.post("/auth/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await endSession(token);
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure });
    return c.body(null, 204);
  });

  /** 404 for every Discord linking route while linking is not configured. */
  const requireDiscordLinking = createMiddleware(async (c, next) => {
    if (discordApplicationId === undefined) return c.json({ error: "discord_linking_disabled" }, 404);
    await next();
  });
  const discordLinked = (c: Context, outcome: DiscordLinkOutcome) =>
    c.redirect(`/?discord=${outcome}`, 302);

  // Both GET routes are full-page navigations, so a missing session sends the browser to login.
  app.get("/auth/discord", requireDiscordLinking, async (c) => {
    if ((await sessionUser(c)) === undefined) return c.redirect("/login", 302);

    const state = randomBytes(32).toString("base64url");
    setCookie(c, DISCORD_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "Lax",
      secure,
      path: DISCORD_STATE_COOKIE_PATH,
      maxAge: STATE_TTL_SECONDS,
    });
    const authorize = new URL(DISCORD_AUTHORIZE_URL);
    authorize.searchParams.set("client_id", discordApplicationId!);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("scope", "identify");
    authorize.searchParams.set("redirect_uri", discordCallbackUrl);
    authorize.searchParams.set("state", state);
    return c.redirect(authorize.toString(), 302);
  });

  app.get("/auth/discord/callback", requireDiscordLinking, async (c) => {
    const expectedState = getCookie(c, DISCORD_STATE_COOKIE);
    deleteCookie(c, DISCORD_STATE_COOKIE, { path: DISCORD_STATE_COOKIE_PATH, secure });

    const user = await sessionUser(c);
    if (user === undefined) return c.redirect("/login", 302);

    const state = c.req.query("state");
    if (!expectedState || !state || !safeEqual(state, expectedState)) return discordLinked(c, "failed");
    // Discord reports a denied consent (or any other authorization error) with `error`.
    if (c.req.query("error") !== undefined) return discordLinked(c, "cancelled");
    const code = c.req.query("code");
    if (!code) return discordLinked(c, "failed");

    try {
      const result = await completeDiscordLink(user.id, code);
      return discordLinked(c, result.status);
    } catch (error) {
      console.error("Discord account linking failed:", error);
      return discordLinked(c, "failed");
    }
  });

  app.delete("/auth/discord", requireDiscordLinking, requireUser, requireSameOriginJson, async (c) => {
    await unlinkDiscordAccount(c.get("user").id);
    return c.body(null, 204);
  });

  const admin = new Hono<AdminEnv>();
  admin.use("*", requireUser, requireAdminRole, requireSameOriginJson);

  admin.get("/members", async (c) => c.json(await listMembers()));

  admin.post("/members", async (c) => {
    const parsed = await readJsonBody(c);
    if (!parsed.ok) return c.json({ error: "malformed_json" }, 400);

    const result = await addMember({
      githubLogin: bodyField(parsed.body, "githubLogin"),
      actor: c.get("user"),
    });
    switch (result.status) {
      case "created":
        return c.json(result.member, 201);
      case "invalid_login":
        return c.json({ error: "invalid_github_login" }, 400);
      case "already_admin":
        return c.json({ error: "already_admin" }, 400);
      case "already_member":
        return c.json({ error: "already_member" }, 409);
    }
  });

  admin.delete("/members/:githubLogin", async (c) => {
    const result = await removeMember(c.req.param("githubLogin"));
    if (result.status === "not_found") return c.json({ error: "member_not_found" }, 404);
    return c.body(null, 204);
  });

  admin.get("/projects", async (c) => c.json(await listProjects()));

  admin.post("/projects", async (c) => {
    const parsed = await readJsonBody(c);
    if (!parsed.ok) return c.json({ error: "malformed_json" }, 400);

    const result = await createProject(parsed.body);
    switch (result.status) {
      case "created":
        return c.json(result.project, 201);
      case "invalid":
        return c.json({ error: INVALID_FIELD_ERRORS[result.field] }, 400);
      case "slug_taken":
      case "prefix_taken":
        return c.json({ error: result.status }, 409);
    }
  });

  admin.get("/projects/:slug", async (c) => {
    const result = await getProject(c.req.param("slug"));
    if (result.status === "not_found") return c.json({ error: "project_not_found" }, 404);
    return c.json(result.project);
  });

  admin.patch("/projects/:slug", async (c) => {
    const parsed = await readJsonBody(c);
    if (!parsed.ok) return c.json({ error: "malformed_json" }, 400);

    const result = await updateProject(c.req.param("slug"), parsed.body);
    switch (result.status) {
      case "updated":
        return c.json(result.project);
      case "not_found":
        return c.json({ error: "project_not_found" }, 404);
      case "empty_update":
        return c.json({ error: "empty_update" }, 400);
      case "invalid":
        return c.json({ error: INVALID_FIELD_ERRORS[result.field] }, 400);
      case "slug_taken":
      case "prefix_taken":
      case "prefix_locked":
        return c.json({ error: result.status }, 409);
    }
  });

  admin.delete("/projects/:slug", async (c) => {
    const result = await deleteProject(c.req.param("slug"));
    if (result.status === "not_found") return c.json({ error: "project_not_found" }, 404);
    return c.body(null, 204);
  });

  admin.post("/projects/:slug/repositories", async (c) => {
    const parsed = await readJsonBody(c);
    if (!parsed.ok) return c.json({ error: "malformed_json" }, 400);

    const result = await addProjectRepository(c.req.param("slug"), bodyField(parsed.body, "fullName"));
    switch (result.status) {
      case "created":
        return c.json(result.repository, 201);
      case "invalid_repository":
        return c.json({ error: "invalid_repository_name" }, 400);
      case "project_not_found":
        return c.json({ error: "project_not_found" }, 404);
      case "repository_taken":
        return c.json({ error: "repository_taken" }, 409);
    }
  });

  admin.delete("/projects/:slug/repositories/:owner/:repo", async (c) => {
    const fullName = `${c.req.param("owner")}/${c.req.param("repo")}`;
    const result = await removeProjectRepository(c.req.param("slug"), fullName);
    if (result.status !== "removed") return c.json({ error: result.status }, 404);
    return c.body(null, 204);
  });

  admin.post("/projects/:slug/members", async (c) => {
    const parsed = await readJsonBody(c);
    if (!parsed.ok) return c.json({ error: "malformed_json" }, 400);

    const result = await addProjectMember(c.req.param("slug"), bodyField(parsed.body, "githubLogin"));
    switch (result.status) {
      case "created":
        return c.json(result.member, 201);
      case "invalid_login":
        return c.json({ error: "invalid_github_login" }, 400);
      case "already_admin":
        return c.json({ error: "already_admin" }, 400);
      case "project_not_found":
      case "member_not_found":
        return c.json({ error: result.status }, 404);
      case "already_project_member":
        return c.json({ error: "already_project_member" }, 409);
    }
  });

  admin.delete("/projects/:slug/members/:githubLogin", async (c) => {
    const result = await removeProjectMember(c.req.param("slug"), c.req.param("githubLogin"));
    if (result.status !== "removed") return c.json({ error: result.status }, 404);
    return c.body(null, 204);
  });

  admin.get("/projects/:slug/tokens", async (c) => {
    const result = await listApiTokens(c.req.param("slug"));
    if (result.status === "project_not_found") return c.json({ error: "project_not_found" }, 404);
    return c.json(result.tokens);
  });

  admin.post("/projects/:slug/tokens", async (c) => {
    const parsed = await readJsonBody(c);
    if (!parsed.ok) return c.json({ error: "malformed_json" }, 400);

    const result = await createApiToken(c.req.param("slug"), parsed.body, c.get("user"));
    switch (result.status) {
      case "created":
        // The only response that ever carries the secret: keep it out of every cache.
        c.header("Cache-Control", "no-store");
        return c.json({ token: result.token, ...result.apiToken }, 201);
      case "invalid":
        return c.json({ error: INVALID_API_TOKEN_FIELD_ERRORS[result.field] }, 400);
      case "project_not_found":
        return c.json({ error: "project_not_found" }, 404);
    }
  });

  admin.delete("/projects/:slug/tokens/:id", async (c) => {
    const result = await revokeApiToken(c.req.param("slug"), c.req.param("id"));
    if (result.status !== "revoked") return c.json({ error: result.status }, 404);
    return c.body(null, 204);
  });

  app.route("/api/admin", admin);

  // Public, so agents can discover the token-readable endpoints.
  app.get("/api/openapi.json", (c) => c.json(openApiDocument));

  // Any signed-in user: admins see every project, members only their own; a token only its project.
  app.get("/api/projects", requireViewer, async (c) => {
    const viewer = c.get("viewer");
    return "kind" in viewer ? c.json([viewer.project]) : c.json(await listVisibleProjects(viewer));
  });

  // Project participants (admins, or members of the project); the use cases check access.
  // Reads also accept a project-scoped API token; writes need the cookie session.
  const tasksApi = new Hono<AdminEnv>();
  tasksApi.on(["POST", "PATCH", "DELETE"], ["/", "/*"], requireUser, requireSameOriginJson);

  tasksApi.get("/", requireViewer, async (c) => {
    const result = await listTasks(c.get("viewer"), c.req.param("slug")!);
    return result.status === "ok" ? c.json(result.tasks) : taskFailure(c, result);
  });

  tasksApi.post("/", async (c) => {
    const parsed = await readJsonBody(c);
    if (!parsed.ok) return c.json({ error: "malformed_json" }, 400);
    const result = await createTask(c.get("user"), c.req.param("slug")!, parsed.body);
    return result.status === "created" ? c.json(result.task, 201) : taskFailure(c, result);
  });

  tasksApi.get("/:key", requireViewer, async (c) => {
    const result = await getTask(c.get("viewer"), c.req.param("slug")!, c.req.param("key"));
    return result.status === "ok" ? c.json(result.task) : taskFailure(c, result);
  });

  tasksApi.patch("/:key", async (c) => {
    const parsed = await readJsonBody(c);
    if (!parsed.ok) return c.json({ error: "malformed_json" }, 400);
    const result = await updateTask(c.get("user"), c.req.param("slug")!, c.req.param("key"), parsed.body);
    return result.status === "ok" ? c.json(result.task) : taskFailure(c, result);
  });

  // Take and release carry no body; the JSON content type is still required (CSRF defense).
  tasksApi.post("/:key/take", async (c) => {
    const result = await takeTask(c.get("user"), c.req.param("slug")!, c.req.param("key"));
    return result.status === "ok" ? c.json(result.task) : taskFailure(c, result);
  });

  tasksApi.post("/:key/release", async (c) => {
    const result = await releaseTask(c.get("user"), c.req.param("slug")!, c.req.param("key"));
    return result.status === "ok" ? c.json(result.task) : taskFailure(c, result);
  });

  // Like every DELETE, it carries no body, so no JSON content type is required.
  tasksApi.delete("/:key", async (c) => {
    const result = await deleteTask(c.get("user"), c.req.param("slug")!, c.req.param("key"));
    return result.status === "deleted" ? c.body(null, 204) : taskFailure(c, result);
  });

  tasksApi.post("/:key/dependencies", async (c) => {
    const parsed = await readJsonBody(c);
    if (!parsed.ok) return c.json({ error: "malformed_json" }, 400);
    const result = await addTaskDependency(
      c.get("user"),
      c.req.param("slug")!,
      c.req.param("key"),
      bodyField(parsed.body, "dependsOnKey"),
    );
    return result.status === "created" ? c.json(result.dependency, 201) : taskFailure(c, result);
  });

  tasksApi.delete("/:key/dependencies/:dependsOnKey", async (c) => {
    const result = await removeTaskDependency(
      c.get("user"),
      c.req.param("slug")!,
      c.req.param("key"),
      c.req.param("dependsOnKey"),
    );
    return result.status === "removed" ? c.body(null, 204) : taskFailure(c, result);
  });

  app.route("/api/projects/:slug/tasks", tasksApi);

  // Same access rules as the tasks routes: admins, or members of the project.
  app.get("/api/projects/:slug/participants", requireViewer, async (c) => {
    const result = await listParticipants(c.get("viewer"), c.req.param("slug"));
    return result.status === "ok" ? c.json(result.participants) : taskFailure(c, result);
  });

  if (webDistDir !== undefined && existsSync(webDistDir)) {
    app.use("/*", serveStatic({ root: webDistDir }));
    // SPA fallback: unknown non-API paths render the web app.
    app.get("*", serveStatic({ root: webDistDir, path: "index.html" }));
  }

  return app;
}
