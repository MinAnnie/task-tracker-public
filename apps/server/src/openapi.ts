import { TASK_PRIORITIES } from "./domain/task-priority.ts";
import { TASK_STATUSES } from "./domain/task-status.ts";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const nullable = (schema: Record<string, unknown>) => ({ oneOf: [schema, { type: "null" }] });
const strings = { type: "array", items: { type: "string" } };
const timestamp = { type: "string", format: "date-time", description: "ISO-8601 timestamp." };
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

/** Responses every write shares, on top of {@link commonErrors}. */
const writeErrors = {
  "403": error(
    "A read-only token (`token_not_allowed`), or a token whose creator is no longer an admin or member of the project (`forbidden`).",
  ),
  "415": error("The body is not declared as `application/json` (`unsupported_media_type`)."),
};

const WRITE_NOTE =
  "Needs a write token (scope `write`): it acts as the admin who created it, with that user's current access, " +
  "and notifications name that user. Read-only tokens get 403 `token_not_allowed`.";

const writeSecurity = [{ bearerAuth: ["write"] }];
const jsonBody = (schema: Record<string, unknown>) => ({
  required: true,
  content: { "application/json": { schema } },
});
const keyParameter = { name: "key", in: "path", required: true, schema: { type: "string" }, example: "RF-14" };

const slugParameter = {
  name: "slug",
  in: "path",
  required: true,
  description: "Slug of the token's project; any other slug answers 404.",
  schema: { type: "string" },
};

/**
 * Hand-written OpenAPI 3.1 description of the endpoints a project-scoped API token may
 * call (reads with any token, a few task writes with a `write` token). `openapi.test.ts` checks real responses against these schemas.
 */
export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Task Tracker API",
    version: "1.0.0",
    description:
      "Access to one project's tasks with an API token created by an admin " +
      "(Admin → project → API tokens). Send it as `Authorization: Bearer ttk_...`. " +
      "Every token reads; a token with the `write` scope may also create and edit tasks and their dependencies " +
      "(the operations marked as such). Every other endpoint and request rejects bearer tokens with 403 " +
      "`token_not_allowed`. Each token may make 120 requests per minute.",
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
      post: {
        operationId: "createTask",
        summary: "Creates a task keyed <PREFIX>-<n>.",
        description: `${WRITE_NOTE} With an assignee it starts in_progress (409 \`dependencies_pending\` while a dependency is not done), otherwise todo.`,
        security: writeSecurity,
        parameters: [slugParameter],
        requestBody: jsonBody(ref("NewTask")),
        responses: {
          "201": { description: "The created task.", content: { "application/json": { schema: ref("TaskDetail") } } },
          "400": error(
            "Invalid field (`invalid_*`, `invalid_stage`, `invalid_assignee`), or unknown dependencies (`invalid_dependency` with `unknownKeys`).",
          ),
          ...commonErrors,
          ...writeErrors,
          "409": error("Assigned while a dependency is pending (`dependencies_pending` with `pendingDependencies`)."),
        },
      },
    },
    "/api/projects/{slug}/tasks/{key}": {
      get: {
        operationId: "getTask",
        summary: "One task by key (case-insensitive), with dependencies, dependents and pull requests.",
        parameters: [slugParameter, keyParameter],
        responses: {
          "200": { description: "The task.", content: { "application/json": { schema: ref("TaskDetail") } } },
          ...commonErrors,
        },
      },
      patch: {
        operationId: "updateTask",
        summary: "Edits a task's title, description, priority, stage or status.",
        description: `${WRITE_NOTE} Changing the status needs the token's creator to be the assignee or an admin; starting work (in_progress, in_review, done) needs every dependency done. Tokens cannot change the assignee (\`assigneeLogin\` answers 403 \`token_not_allowed\`).`,
        security: writeSecurity,
        parameters: [slugParameter, keyParameter],
        requestBody: jsonBody(ref("TaskChanges")),
        responses: {
          "200": { description: "The updated task.", content: { "application/json": { schema: ref("TaskDetail") } } },
          "400": error("Invalid field (`invalid_*`, `invalid_stage`) or nothing to change (`empty_update`)."),
          ...commonErrors,
          ...writeErrors,
          "409": error("Starting work while a dependency is pending (`dependencies_pending` with `pendingDependencies`)."),
        },
      },
    },
    "/api/projects/{slug}/tasks/{key}/dependencies": {
      post: {
        operationId: "addDependency",
        summary: "Makes the task depend on another task of the project.",
        description: WRITE_NOTE,
        security: writeSecurity,
        parameters: [slugParameter, keyParameter],
        requestBody: jsonBody(ref("NewDependency")),
        responses: {
          "201": { description: "The task depended on.", content: { "application/json": { schema: ref("TaskLink") } } },
          "400": error("A task cannot depend on itself (`self_dependency`), or the key is missing (`invalid_task_key`)."),
          ...commonErrors,
          ...writeErrors,
          "409": error("Already a dependency (`dependency_exists`), or it would close a cycle (`dependency_cycle`)."),
        },
      },
    },
    "/api/projects/{slug}/tasks/{key}/dependencies/{dependsOnKey}": {
      delete: {
        operationId: "removeDependency",
        summary: "Removes a dependency of the task.",
        description: WRITE_NOTE,
        security: writeSecurity,
        parameters: [
          slugParameter,
          keyParameter,
          { name: "dependsOnKey", in: "path", required: true, schema: { type: "string" }, example: "RF-13" },
        ],
        responses: {
          "204": { description: "Removed." },
          ...commonErrors,
          "404": error("No such project, task or dependency (`project_not_found`, `task_not_found`, `dependency_not_found`)."),
          "403": writeErrors["403"],
        },
      },
    },
    "/api/projects/{slug}/stages": {
      get: {
        operationId: "listStages",
        summary: "The project's stages in board order. A task's `stage` is one of these names, or null.",
        parameters: [slugParameter],
        responses: {
          "200": {
            description: "The stages.",
            content: { "application/json": { schema: { type: "array", items: ref("Stage") } } },
          },
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
        description:
          "A project-scoped API token (`ttk_` followed by 43 base64url characters). Operations listing the `write` scope need a write token.",
      },
    },
    schemas: {
      Project: {
        type: "object",
        additionalProperties: false,
        required: ["id", "slug", "name", "taskKeyPrefix", "discordInviteUrl"],
        properties: {
          id: { type: "integer" },
          slug: { type: "string" },
          name: { type: "string" },
          taskKeyPrefix: { type: "string" },
          discordInviteUrl: {
            ...nullable({ type: "string" }),
            description: "Invite to the project's Discord server, or null when none is set.",
          },
        },
      },
      Stage: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "position"],
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          position: { type: "integer", description: "0-based board order." },
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
          "createdAt",
          "updatedAt",
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
          createdAt: timestamp,
          updatedAt: { ...timestamp, description: "When any field of the task last changed." },
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
          "createdAt",
          "updatedAt",
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
          createdAt: timestamp,
          updatedAt: { ...timestamp, description: "When any field of the task last changed." },
        },
      },
      NewTask: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string", description: "1–200 characters." },
          description: { type: "string", description: "Up to 10000 characters." },
          priority: ref("TaskPriority"),
          stage: { type: "string", description: "One of the project's stages (GET /api/projects/{slug}/stages)." },
          assigneeLogin: { type: "string", description: "A project participant who signed in at least once." },
          dependsOnKeys: {
            ...strings,
            maxItems: 50,
            description: "Keys of existing tasks of the project the new task depends on (case-insensitive).",
          },
        },
      },
      TaskChanges: {
        type: "object",
        description: "Only the fields to change; at least one.",
        properties: {
          title: { type: "string" },
          description: nullable({ type: "string" }),
          priority: ref("TaskPriority"),
          stage: { ...nullable({ type: "string" }), description: "One of the project's stages, or null." },
          status: ref("TaskStatus"),
        },
      },
      NewDependency: {
        type: "object",
        required: ["dependsOnKey"],
        properties: { dependsOnKey: { type: "string", example: "RF-13" } },
      },
      Error: {
        type: "object",
        required: ["error"],
        properties: { error: { type: "string" } },
      },
    },
  },
} as const;
