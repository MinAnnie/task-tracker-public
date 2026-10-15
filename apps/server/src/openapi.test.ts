import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTaskStore } from "../test/fakes/in-memory-task-store.ts";
import { RecordingNotifications } from "../test/fakes/recording-notifications.ts";
import { createApp, type AppDeps } from "./app.ts";
import type { ApiTokenCaller } from "./application/api-tokens.ts";
import { getTask, listParticipants, listTasks, type TasksDeps } from "./application/tasks.ts";
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

type Operation = { responses: Record<string, { content?: { "application/json": { schema: Schema } } }> };

const responseSchema = (path: keyof typeof openApiDocument.paths, status: string): Schema => {
  const operation = openApiDocument.paths[path].get as unknown as Operation;
  const schema = operation.responses[status]?.content?.["application/json"].schema;
  if (schema === undefined) throw new Error(`No ${status} schema for ${path}`);
  return schema;
};

const TOKEN = `ttk_${"d".repeat(43)}`;
const caller: ApiTokenCaller = {
  kind: "api_token",
  tokenId: 1,
  projectId: 3,
  project: { id: 3, slug: "shop", name: "Shop", taskKeyPrefix: "RF" },
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
      findSessionUser: async () => undefined,
      endSession: unused,
      listMembers: unused,
      addMember: unused,
      removeMember: unused,
      listProjects: unused,
      listVisibleProjects: unused,
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
      createTask: unused,
      takeTask: unused,
      releaseTask: unused,
      updateTask: unused,
      addTaskDependency: unused,
      removeTaskDependency: unused,
      deleteTask: unused,
      discordApplicationId: undefined,
      completeDiscordLink: unused,
      findDiscordAccount: unused,
      unlinkDiscordAccount: unused,
      discordPublicKey: undefined,
      handleDiscordInteraction: unused,
      authenticateApiToken: async (token) => (token === TOKEN ? caller : undefined),
      rateLimitApiToken: () => ({ allowed: true }),
      listApiTokens: unused,
      createApiToken: unused,
      revokeApiToken: unused,
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

  it("describes the real errors", async () => {
    const invalid = await get("/api/projects/shop/tasks", `ttk_${"x".repeat(43)}`);
    expect(invalid.status).toBe(401);
    expect(validate(responseSchema("/api/projects/{slug}/tasks", "401"), invalid.body)).toEqual([]);

    const notFound = await get("/api/projects/blog/tasks");
    expect(notFound.status).toBe(404);
    expect(validate(responseSchema("/api/projects/{slug}/tasks", "404"), notFound.body)).toEqual([]);
  });

  it("would catch an undocumented or mistyped field", () => {
    const schema = responseSchema("/api/projects/{slug}/tasks/{key}", "200");
    expect(validate(schema, { key: "RF-1" }).length).toBeGreaterThan(0);
    expect(validate({ $ref: "#/components/schemas/Participant" }, { login: "a", name: 1, avatarUrl: null, x: 1 }))
      .toEqual(["$.x: undocumented", "$.name: matches 0 oneOf branches"]);
  });
});
