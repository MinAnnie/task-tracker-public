import { TASK_PRIORITIES } from "./domain/task-priority.ts";
import { TASK_STATUSES } from "./domain/task-status.ts";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const nullable = (schema: Record<string, unknown>) => ({ oneOf: [schema, { type: "null" }] });
const strings = { type: "array", items: { type: "string" } };
const error = (description: string) => ({
  description,
  content: { "application/json": { schema: ref("Error") } },
});

const commonErrors = {
  "401": error("Missing, malformed, unknown, revoked or expired token (`invalid_token`)."),
  "404": error("No such project for this token (`project_not_found`), or no such task (`task_not_found`)."),
  "429": {
    description: "Too many requests for this token (`rate_limited`).",
    headers: { "Retry-After": { description: "Seconds until the limit resets.", schema: { type: "integer" } } },
    content: { "application/json": { schema: ref("Error") } },
  },
};

const slugParameter = {
  name: "slug",
  in: "path",
  required: true,
  description: "Slug of the token's project; any other slug answers 404.",
  schema: { type: "string" },
};

/**
 * Hand-written OpenAPI 3.1 description of the endpoints a project-scoped, read-only
 * API token may call. `openapi.test.ts` checks real responses against these schemas.
 */
export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Task Tracker API",
    version: "1.0.0",
    description:
      "Read-only access to one project's tasks with an API token created by an admin " +
      "(Admin → project → API tokens). Send it as `Authorization: Bearer ttk_...`. " +
      "Every other endpoint, and every non-GET request, rejects bearer tokens with 403 `token_not_allowed`. " +
      "Each token may make 120 requests per minute.",
  },
  servers: [{ url: "/" }],
  security: [{ bearerAuth: [] }],
  paths: {
    "/api/projects": {
      get: {
        operationId: "listProjects",
        summary: "The token's project (a one-element list).",
        responses: {
          "200": {
            description: "Projects visible to the caller.",
            content: { "application/json": { schema: { type: "array", items: ref("Project") } } },
          },
          "401": commonErrors["401"],
          "429": commonErrors["429"],
        },
      },
    },
    "/api/projects/{slug}/tasks": {
      get: {
        operationId: "listTasks",
        summary: "The project board: every task, sorted by priority, then key number.",
        parameters: [slugParameter],
        responses: {
          "200": {
            description: "The tasks of the project.",
            content: { "application/json": { schema: { type: "array", items: ref("TaskListItem") } } },
          },
          ...commonErrors,
        },
      },
    },
    "/api/projects/{slug}/tasks/{key}": {
      get: {
        operationId: "getTask",
        summary: "One task by key (case-insensitive), with dependencies, dependents and pull requests.",
        parameters: [
          slugParameter,
          { name: "key", in: "path", required: true, schema: { type: "string" }, example: "RF-14" },
        ],
        responses: {
          "200": { description: "The task.", content: { "application/json": { schema: ref("TaskDetail") } } },
          ...commonErrors,
        },
      },
    },
    "/api/projects/{slug}/participants": {
      get: {
        operationId: "listParticipants",
        summary: "People who can be assigned tasks in the project, sorted by login.",
        parameters: [slugParameter],
        responses: {
          "200": {
            description: "The participants.",
            content: { "application/json": { schema: { type: "array", items: ref("Participant") } } },
          },
          ...commonErrors,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "A project-scoped API token (`ttk_` followed by 43 base64url characters).",
      },
    },
    schemas: {
      Project: {
        type: "object",
        additionalProperties: false,
        required: ["id", "slug", "name", "taskKeyPrefix"],
        properties: {
          id: { type: "integer" },
          slug: { type: "string" },
          name: { type: "string" },
          taskKeyPrefix: { type: "string" },
        },
      },
      TaskStatus: { type: "string", enum: [...TASK_STATUSES] },
      TaskPriority: { type: "string", enum: [...TASK_PRIORITIES] },
      PullRequestState: { type: "string", enum: ["open", "closed", "merged"] },
      Participant: {
        type: "object",
        additionalProperties: false,
        required: ["login", "name", "avatarUrl"],
        properties: {
          login: { type: "string" },
          name: nullable({ type: "string" }),
          avatarUrl: nullable({ type: "string" }),
        },
      },
      TaskLink: {
        type: "object",
        additionalProperties: false,
        required: ["key", "title", "status"],
        properties: { key: { type: "string" }, title: { type: "string" }, status: ref("TaskStatus") },
      },
      TaskListItem: {
        type: "object",
        additionalProperties: false,
        required: [
          "key",
          "title",
          "status",
          "priority",
          "stage",
          "assignee",
          "pullRequests",
          "dependsOn",
          "pendingDependencies",
          "canTake",
        ],
        properties: {
          key: { type: "string" },
          title: { type: "string" },
          status: ref("TaskStatus"),
          priority: ref("TaskPriority"),
          stage: nullable({ type: "string" }),
          assignee: nullable(ref("Participant")),
          pullRequests: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["number", "state", "url"],
              properties: { number: { type: "integer" }, state: ref("PullRequestState"), url: { type: "string" } },
            },
          },
          dependsOn: { ...strings, description: "Keys of the tasks this one depends on." },
          pendingDependencies: { ...strings, description: "Keys of the dependencies that are not done yet." },
          canTake: { type: "boolean", description: "Always false for API tokens." },
        },
      },
      TaskDetail: {
        type: "object",
        additionalProperties: false,
        required: [
          "key",
          "title",
          "description",
          "status",
          "priority",
          "stage",
          "assignee",
          "canTake",
          "pendingDependencies",
          "dependsOn",
          "blocks",
          "pullRequests",
        ],
        properties: {
          key: { type: "string" },
          title: { type: "string" },
          description: nullable({ type: "string" }),
          status: ref("TaskStatus"),
          priority: ref("TaskPriority"),
          stage: nullable({ type: "string" }),
          assignee: nullable(ref("Participant")),
          canTake: { type: "boolean", description: "Always false for API tokens." },
          pendingDependencies: strings,
          dependsOn: { type: "array", items: ref("TaskLink") },
          blocks: { type: "array", items: ref("TaskLink"), description: "Tasks that depend on this one." },
          pullRequests: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["number", "title", "branch", "url", "state", "author"],
              properties: {
                number: { type: "integer" },
                title: { type: "string" },
                branch: { type: "string" },
                url: { type: "string" },
                state: ref("PullRequestState"),
                author: { type: "string" },
              },
            },
          },
        },
      },
      Error: {
        type: "object",
        required: ["error"],
        properties: { error: { type: "string" } },
      },
    },
  },
} as const;
