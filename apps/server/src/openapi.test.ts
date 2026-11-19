import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryApiTokenStore } from "../test/fakes/in-memory-api-token-store.ts";
import { InMemoryTaskStore } from "../test/fakes/in-memory-task-store.ts";
import { RecordingNotifications } from "../test/fakes/recording-notifications.ts";
import { createApp, type AppDeps } from "./app.ts";
import {
  createPersonalApiToken,
  listPersonalApiTokens,
  revokePersonalApiToken,
  type ApiTokenCaller,
  type ApiTokensDeps,
} from "./application/api-tokens.ts";
import type { AuthenticatedUser } from "./application/sessions.ts";
import {
  addTaskDependency,
  createTask,
  getTask,
  listParticipants,
  listProjectStages,
  listTasks,
  removeTaskDependency,
  updateTask,
  type TasksDeps,
} from "./application/tasks.ts";
import { openApiDocument } from "./openapi.ts";

type Schema = Record<string, unknown>;

/**
 * Minimal JSON Schema check covering the keywords the document uses ($ref, oneOf,
 * type, enum, required, properties, additionalProperties: false, items). Returns the
 * paths that do not match, so failures say where the response drifted.
 */
function validate(schema: Schema, value: unknown, path = "$"): string[] {
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.replace("#/components/schemas/", "");
    const target = (openApiDocument.components.schemas as Record<string, Schema>)[name];
    if (target === undefined) return [`${path}: unknown $ref ${schema.$ref}`];
    return validate(target, value, path);
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = (schema.oneOf as Schema[]).filter((s) => validate(s, value, path).length === 0);
    return matches.length === 1 ? [] : [`${path}: matches ${matches.length} oneOf branches`];
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return [`${path}: ${String(value)} not in enum`];
  switch (schema.type) {
    case "null":
      return value === null ? [] : [`${path}: expected null`];
    case "string":
      return typeof value === "string" ? [] : [`${path}: expected string`];
    case "boolean":
      return typeof value === "boolean" ? [] : [`${path}: expected boolean`];
    case "integer":
      return Number.isInteger(value) ? [] : [`${path}: expected integer`];
    case "array":
      if (!Array.isArray(value)) return [`${path}: expected array`];
      return value.flatMap((item, i) => validate(schema.items as Schema, item, `${path}[${i}]`));
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${path}: expected object`];
      const properties = (schema.properties ?? {}) as Record<string, Schema>;
      const record = value as Record<string, unknown>;
      const missing = ((schema.required ?? []) as string[])
        .filter((key) => !(key in record))
        .map((key) => `${path}.${key}: missing`);
      const extra =
        schema.additionalProperties === false
          ? Object.keys(record).filter((key) => !(key in properties)).map((key) => `${path}.${key}: undocumented`)
          : [];
      const nested = Object.entries(properties).flatMap(([key, sub]) =>
        key in record ? validate(sub, record[key], `${path}.${key}`) : [],
      );
      return [...missing, ...extra, ...nested];
    }
    default:
      return [];
  }
}

type Operation = {
  description?: string;
  security?: unknown;
  requestBody?: unknown;
  responses: Record<string, { content?: { "application/json": { schema: Schema } } }>;
};
type Method = "get" | "post" | "patch" | "delete";

const operationOf = (path: keyof typeof openApiDocument.paths, method: Method): Operation => {
  const operation = (openApiDocument.paths[path] as Record<string, unknown>)[method];
  if (operation === undefined) throw new Error(`No ${method} operation for ${path}`);
  return operation as Operation;
};

const responseSchema = (path: keyof typeof openApiDocument.paths, status: string, method: Method = "get"): Schema => {
  const operation = operationOf(path, method);
  const schema = operation.responses[status]?.content?.["application/json"].schema;
  if (schema === undefined) throw new Error(`No ${status} schema for ${path}`);
  return schema;
};

const TOKEN = `ttk_${"d".repeat(43)}`;
const WRITE_TOKEN = `ttk_${"w".repeat(43)}`;
const PERSONAL_TOKEN = `ttk_${"p".repeat(43)}`;
const ORIGIN = "https://tasks.example.com";
const mona = { id: 2, githubLogin: "mona", name: "Mona", avatarUrl: null };
const caller: ApiTokenCaller = {
  kind: "api_token",
  tokenId: 1,
  projectId: 3,
  project: { id: 3, slug: "shop", name: "Shop", taskKeyPrefix: "RF", discordInviteUrl: "https://discord.gg/shop" },
  scope: "read",
  creator: { id: 2, githubLogin: "mona", name: "Mona", avatarUrl: null },
};

const monaMember: AuthenticatedUser = { ...mona, role: "member" };
const personalCaller: ApiTokenCaller = {
  kind: "api_token",
  tokenId: 2,
  projectId: null,
  project: null,
  scope: "read",
  creator: mona,
  owner: monaMember,
};

describe("OpenAPI document", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const store = new InMemoryTaskStore();
    store.projects.push({ id: 3, slug: "shop", taskKeyPrefix: "RF", nextTaskNumber: 3, discordChannelId: null });
    store.users.push({ id: 2, githubLogin: "mona", name: "Mona", avatarUrl: null });
    store.projectMembers.push({ projectId: 3, githubLogin: "mona" });
    store.tasks.push(
      {
        id: 1,
        projectId: 3,
        key: "RF-1",
        title: "API",
        description: "Build it",
        status: "in_progress",
        priority: "high",
        stage: "Backend",
        assigneeId: 2,
        createdAt: new Date("2026-01-01T10:00:00.000Z"),
        updatedAt: new Date("2026-01-02T10:00:00.000Z"),
      },
      {
        id: 2,
        projectId: 3,
        key: "RF-2",
        title: "Checkout",
        description: null,
        status: "todo",
        priority: "medium",
        stage: null,
        assigneeId: null,
        createdAt: new Date("2026-01-03T10:00:00.000Z"),
        updatedAt: new Date("2026-01-03T10:00:00.000Z"),
      },
    );
    store.dependencies.push({ taskId: 2, dependsOnTaskId: 1 });
    store.stages.push({ id: 1, projectId: 3, name: "Backend", position: 0 });
    store.pullRequests.push({
      taskId: 1,
      number: 7,
      title: "RF-1 API",
      branch: "feat/RF-1",
      url: "https://github.com/acme/shop/pull/7",
      state: "open",
      authorGithubLogin: "mona",
    });
    const tasksDeps: TasksDeps = { store, adminLogins: [], notifications: new RecordingNotifications() };
    const tokenStore = new InMemoryApiTokenStore();
    tokenStore.users.push(mona);
    const tokensDeps: ApiTokensDeps = { store: tokenStore, adminLogins: [], isMember: async () => true };

    const unused = async () => {
      throw new Error("not used");
    };
    app = createApp({
      checkDatabase: async () => {},
      githubWebhookSecret: "secret",
      handlePullRequestEvent: unused,
      githubClientId: "id",
      appBaseUrl: "https://tasks.example.com",
      completeGithubLogin: unused,
      findSessionUser: async (session) => (session === "session-token" ? monaMember : undefined),
      endSession: unused,
      listMembers: unused,
      addMember: unused,
      removeMember: unused,
      listProjects: unused,
      listVisibleProjects: async () => [caller.project],
      createProject: unused,
      getProject: unused,
      updateProject: unused,
      deleteProject: unused,
      addProjectRepository: unused,
      removeProjectRepository: unused,
      addProjectMember: unused,
      removeProjectMember: unused,
      listTasks: (viewer, slug) => listTasks(tasksDeps, viewer, slug),
      listParticipants: (viewer, slug) => listParticipants(tasksDeps, viewer, slug),
      getTask: (viewer, slug, key) => getTask(tasksDeps, viewer, slug, key),
      createTask: (user, slug, body) => createTask(tasksDeps, user, slug, body),
      takeTask: unused,
      releaseTask: unused,
      updateTask: (user, slug, key, body) => updateTask(tasksDeps, user, slug, key, body),
      addTaskDependency: (user, slug, key, dependsOnKey) => addTaskDependency(tasksDeps, user, slug, key, dependsOnKey),
      removeTaskDependency: (user, slug, key, dependsOnKey) =>
        removeTaskDependency(tasksDeps, user, slug, key, dependsOnKey),
      deleteTask: unused,
      discordApplicationId: undefined,
      discordBotInstallEnabled: false,
      completeDiscordBotInstall: unused,
      listDiscordChannels: unused,
      selectDiscordChannel: unused,
      completeDiscordLink: unused,
      findDiscordAccount: unused,
      unlinkDiscordAccount: unused,
      discordPublicKey: undefined,
      handleDiscordInteraction: unused,
      authenticateApiToken: async (token) => {
        if (token === TOKEN) return caller;
        if (token === PERSONAL_TOKEN) return personalCaller;
        return token === WRITE_TOKEN ? { ...caller, scope: "write" } : undefined;
      },
      resolveApiTokenActor: async () => ({ ...mona, role: "member" }),
      rateLimitApiToken: () => ({ allowed: true }),
      listApiTokens: unused,
      createApiToken: unused,
      revokeApiToken: unused,
      listPersonalApiTokens: (owner) => listPersonalApiTokens(tokensDeps, owner),
      createPersonalApiToken: (body, owner) => createPersonalApiToken(tokensDeps, body, owner),
      revokePersonalApiToken: (owner, tokenId) => revokePersonalApiToken(tokensDeps, owner, tokenId),
      listProjectStages: (viewer, slug) => listProjectStages(tasksDeps, viewer, slug),
      listStages: unused,
      createStage: unused,
      updateStage: unused,
      deleteStage: unused,
    } satisfies AppDeps);
  });

  const get = async (path: string, token = TOKEN) => {
    const res = await app.request(path, { headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, body: (await res.json()) as unknown };
  };

  it("is an OpenAPI 3.1 document with a bearer security scheme", () => {
    expect(openApiDocument.openapi).toBe("3.1.0");
    expect(openApiDocument.components.securitySchemes.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
  });

  it("describes the real project list", async () => {
    const { status, body } = await get("/api/projects");
    expect(status).toBe(200);
    expect(validate(responseSchema("/api/projects", "200"), body)).toEqual([]);
  });

  it("describes the real task list", async () => {
    const { status, body } = await get("/api/projects/shop/tasks");
    expect(status).toBe(200);
    expect(body).toHaveLength(2);
    expect(validate(responseSchema("/api/projects/{slug}/tasks", "200"), body)).toEqual([]);
  });

  it("describes the real task detail", async () => {
    for (const key of ["RF-1", "RF-2"]) {
      const { status, body } = await get(`/api/projects/shop/tasks/${key}`);
      expect(status).toBe(200);
      expect(validate(responseSchema("/api/projects/{slug}/tasks/{key}", "200"), body)).toEqual([]);
    }
  });

  it("describes the real participants", async () => {
    const { status, body } = await get("/api/projects/shop/participants");
    expect(status).toBe(200);
    expect(validate(responseSchema("/api/projects/{slug}/participants", "200"), body)).toEqual([]);
  });

  it("describes the real stages", async () => {
    const { status, body } = await get("/api/projects/shop/stages");
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(validate(responseSchema("/api/projects/{slug}/stages", "200"), body)).toEqual([]);
  });

  it("describes the real errors", async () => {
    const invalid = await get("/api/projects/shop/tasks", `ttk_${"x".repeat(43)}`);
    expect(invalid.status).toBe(401);
    expect(validate(responseSchema("/api/projects/{slug}/tasks", "401"), invalid.body)).toEqual([]);

    const notFound = await get("/api/projects/blog/tasks");
    expect(notFound.status).toBe(404);
    expect(validate(responseSchema("/api/projects/{slug}/tasks", "404"), notFound.body)).toEqual([]);
  });

  const send = async (method: string, path: string, body?: unknown, token = WRITE_TOKEN) => {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: res.status === 204 ? undefined : ((await res.json()) as unknown) };
  };

  it("describes the real writes of a write token", async () => {
    const created = await send("POST", "/api/projects/shop/tasks", { title: "Docs", stage: "backend", dependsOnKeys: ["RF-1"] });
    expect(created.status).toBe(201);
    expect(validate(responseSchema("/api/projects/{slug}/tasks", "201", "post"), created.body)).toEqual([]);

    const updated = await send("PATCH", "/api/projects/shop/tasks/RF-3", { priority: "high" });
    expect(updated.status).toBe(200);
    expect(validate(responseSchema("/api/projects/{slug}/tasks/{key}", "200", "patch"), updated.body)).toEqual([]);

    const added = await send("POST", "/api/projects/shop/tasks/RF-3/dependencies", { dependsOnKey: "RF-2" });
    expect(added.status).toBe(201);
    expect(validate(responseSchema("/api/projects/{slug}/tasks/{key}/dependencies", "201", "post"), added.body)).toEqual([]);

    const removed = await send("DELETE", "/api/projects/shop/tasks/RF-3/dependencies/RF-2");
    expect(removed.status).toBe(204);
    expect(operationOf("/api/projects/{slug}/tasks/{key}/dependencies/{dependsOnKey}", "delete").responses["204"]).toBeDefined();

    const refused = await send("POST", "/api/projects/shop/tasks", { title: "Docs" }, TOKEN);
    expect(refused.status).toBe(403);
    expect(validate(responseSchema("/api/projects/{slug}/tasks", "403", "post"), refused.body)).toEqual([]);
  });

  it("documents every write as needing a write token", () => {
    const writes = [
      ["/api/projects/{slug}/tasks", "post"],
      ["/api/projects/{slug}/tasks/{key}", "patch"],
      ["/api/projects/{slug}/tasks/{key}/dependencies", "post"],
      ["/api/projects/{slug}/tasks/{key}/dependencies/{dependsOnKey}", "delete"],
    ] as const;
    for (const [path, method] of writes) {
      const operation = operationOf(path, method);
      expect(operation.security).toEqual([{ bearerAuth: ["write"] }]);
      expect(operation.description).toContain("write");
    }
  });

  it("describes the real reads of a personal token", async () => {
    const projects = await get("/api/projects", PERSONAL_TOKEN);
    expect(projects.status).toBe(200);
    expect(validate(responseSchema("/api/projects", "200"), projects.body)).toEqual([]);

    const tasks = await get("/api/projects/shop/tasks", PERSONAL_TOKEN);
    expect(tasks.status).toBe(200);
    expect(validate(responseSchema("/api/projects/{slug}/tasks", "200"), tasks.body)).toEqual([]);
  });

  /** A cookie-session request with the same-origin JSON headers the account endpoints need. */
  const account = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { cookie: "session=session-token", origin: ORIGIN };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: res.status === 204 ? undefined : ((await res.json()) as unknown) };
  };

  it("describes the real personal token management of the signed-in user", async () => {
    const created = await account("POST", "/api/account/tokens", { name: "Laptop", expiresInDays: 30 });
    expect(created.status).toBe(201);
    expect(validate(responseSchema("/api/account/tokens", "201", "post"), created.body)).toEqual([]);

    const listed = await account("GET", "/api/account/tokens");
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
    expect(validate(responseSchema("/api/account/tokens", "200"), listed.body)).toEqual([]);

    const refused = await account("POST", "/api/account/tokens", { name: "Agent", scope: "write" });
    expect(refused.status).toBe(403);
    expect(validate(responseSchema("/api/account/tokens", "403", "post"), refused.body)).toEqual([]);

    const revoked = await account("DELETE", "/api/account/tokens/1");
    expect(revoked.status).toBe(204);
    expect(operationOf("/api/account/tokens/{id}", "delete").responses["204"]).toBeDefined();
    const missing = await account("DELETE", "/api/account/tokens/99");
    expect(missing.status).toBe(404);
    expect(validate(responseSchema("/api/account/tokens/{id}", "404", "delete"), missing.body)).toEqual([]);
  });

  it("documents the account endpoints as cookie-session only", () => {
    for (const [path, method] of [
      ["/api/account/tokens", "get"],
      ["/api/account/tokens", "post"],
      ["/api/account/tokens/{id}", "delete"],
    ] as const) {
      expect(operationOf(path, method).security).toEqual([{ cookieAuth: [] }]);
    }
    expect(openApiDocument.info.description).toContain("personal");
  });

  it("would catch an undocumented or mistyped field", () => {
    const schema = responseSchema("/api/projects/{slug}/tasks/{key}", "200");
    expect(validate(schema, { key: "RF-1" }).length).toBeGreaterThan(0);
    expect(validate({ $ref: "#/components/schemas/Participant" }, { login: "a", name: 1, avatarUrl: null, x: 1 }))
      .toEqual(["$.x: undocumented", "$.name: matches 0 oneOf branches"]);
  });
});
