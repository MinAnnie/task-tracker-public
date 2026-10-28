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
  "401": error(
    "Missing, malformed, unknown, revoked or expired token, or a personal token whose owner is no longer an admin or member (`invalid_token`).",
  ),
  "403": error(
    "A personal token whose owner cannot access this project (`forbidden`), exactly like their signed-in session.",
  ),
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
    "A read-only token, or a personal write token whose owner is no longer an admin (`token_not_allowed`); a project token whose creator is no longer an admin or member of the project, or a personal token whose owner cannot access it (`forbidden`).",
  ),
  "415": error("The body is not declared as `application/json` (`unsupported_media_type`)."),
};

const WRITE_NOTE =
  "Needs a write token (scope `write`): it acts as the admin who created it (a project token) or owns it " +
  "(a personal token), with that user's current access, and notifications name that user. " +
  "Read-only tokens get 403 `token_not_allowed`.";

const writeSecurity = [{ bearerAuth: ["write"] }];
const jsonBody = (schema: Record<string, unknown>) => ({
  required: true,
  content: { "application/json": { schema } },
});
const ACCOUNT_NOTE =
  "Cookie session only (same-origin JSON requests from the web app); any request with an `Authorization` " +
  "header answers 403 `token_not_allowed`. Open to every signed-in user, who only ever sees their own tokens.";
const cookieSecurity = [{ cookieAuth: [] }];
const accountErrors = {
  "401": error("Not signed in (`unauthenticated`)."),
  "403": error("A foreign Origin (`invalid_origin`), or an `Authorization` header (`token_not_allowed`)."),
};
const apiTokenProperties = {
  id: { type: "integer" },
  name: { type: "string" },
  prefix: { type: "string", description: "First 8 characters after `ttk_`." },
  scope: { type: "string", enum: ["read", "write"] },
  createdAt: timestamp,
  createdBy: nullable({ type: "string" }),
  lastUsedAt: nullable(timestamp),
  expiresAt: nullable(timestamp),
  revokedAt: nullable(timestamp),
  status: { type: "string", enum: ["active", "expired", "revoked"] },
};

const keyParameter = { name: "key", in: "path", required: true, schema: { type: "string" }, example: "RF-14" };

const slugParameter = {
  name: "slug",
  in: "path",
  required: true,
  description:
    "Slug of the project. A project token only reaches its own project (any other slug answers 404); " +
    "a personal token reaches every project its owner can access.",
  schema: { type: "string" },
};

/**
 * Hand-written OpenAPI 3.1 description of the endpoints an API token may call (reads with
 * any token, a few task writes with a `write` token), plus the cookie-session endpoints
 * that manage personal tokens. `openapi.test.ts` checks real responses against these schemas.
 */
export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Task Tracker API",
    version: "1.0.0",
    description:
      "Access to tasks with an API token, sent as `Authorization: Bearer ttk_...`. " +
      "A project token is created by an admin (Admin → project → API tokens) and reaches that one project. " +
      "A personal token is created by any signed-in user for themselves (account menu → API tokens) and works " +
      "with every project they can access, re-checked on every request: all projects for admins, the projects " +
      "a member belongs to (others answer 403 `forbidden`, like their session). Personal tokens of members are " +
      "read only. " +
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
        summary: "The token's project (a one-element list) for a project token; every project the owner can access for a personal token.",
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
        description: `${WRITE_NOTE} With an assignee it starts in_progress (409 \`dependencies_pending\` while a dependency is not done), otherwise todo. Tokens cannot set the assignee (\`assigneeLogin\` answers 403 \`token_not_allowed\`).`,
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
    "/api/account/tokens": {
      get: {
        operationId: "listPersonalTokens",
        summary: "The signed-in user's own personal tokens, newest first.",
        description: ACCOUNT_NOTE,
        security: cookieSecurity,
        responses: {
          "200": {
            description: "The personal tokens; never their secrets.",
            content: { "application/json": { schema: { type: "array", items: ref("ApiToken") } } },
          },
          ...accountErrors,
        },
      },
      post: {
        operationId: "createPersonalToken",
        summary: "Creates a personal token for the signed-in user; the secret is returned only here.",
        description: `${ACCOUNT_NOTE} Members may only create \`read\` tokens; admins may also choose \`write\`.`,
        security: cookieSecurity,
        requestBody: jsonBody(ref("NewApiToken")),
        responses: {
          "201": {
            description: "The created token with its secret (`Cache-Control: no-store`).",
            content: { "application/json": { schema: ref("CreatedApiToken") } },
          },
          "400": error("Invalid field (`invalid_body`, `invalid_token_name`, `invalid_token_expiry`, `invalid_token_scope`) or `malformed_json`."),
          ...accountErrors,
          "403": error(
            "A member asked for a `write` token (`token_scope_not_allowed`), a foreign Origin (`invalid_origin`), or an `Authorization` header (`token_not_allowed`).",
          ),
          "415": error("The body is not declared as `application/json` (`unsupported_media_type`)."),
        },
      },
    },
    "/api/account/tokens/{id}": {
      delete: {
        operationId: "revokePersonalToken",
        summary: "Revokes one of the signed-in user's personal tokens (idempotent).",
        description: ACCOUNT_NOTE,
        security: cookieSecurity,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          "204": { description: "Revoked." },
          ...accountErrors,
          "404": error("No such token among the user's personal tokens (`token_not_found`)."),
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
          "A project or personal API token (`ttk_` followed by 43 base64url characters). Operations listing the `write` scope need a write token.",
      },
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "session",
        description: "The web app's session cookie (sign in with GitHub). API tokens are refused here.",
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
      ApiToken: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "prefix", "scope", "createdAt", "createdBy", "lastUsedAt", "expiresAt", "revokedAt", "status"],
        properties: apiTokenProperties,
      },
      CreatedApiToken: {
        type: "object",
        additionalProperties: false,
        required: ["token", "id", "name", "prefix", "scope", "createdAt", "createdBy", "lastUsedAt", "expiresAt", "revokedAt", "status"],
        properties: {
          token: { type: "string", description: "The secret (`ttk_...`). Shown once; only its hash is stored." },
          ...apiTokenProperties,
        },
      },
      NewApiToken: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "1–60 characters." },
          expiresInDays: { ...nullable({ type: "integer" }), description: "1–365 days; null or absent never expires." },
          scope: { type: "string", enum: ["read", "write"], description: "Defaults to read; write is for admins only." },
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
