import type { NewTaskInput, Project, TaskChanges, TaskDetail, TaskLink, TaskListItem } from "./types.ts";

export type TrackerErrorKind =
  | "unauthorized"
  | "forbidden"
  | "read_only"
  | "not_found"
  | "rejected"
  | "rate_limited"
  | "unreachable"
  | "http";

export const READ_ONLY_TOKEN_MESSAGE =
  "This token is read-only. Create a Read & write token in Admin → the project → API tokens.";

/** A failed API call, with a message safe to show to the model (never contains the token). */
export class TrackerApiError extends Error {
  readonly kind: TrackerErrorKind;
  readonly retryAfterSeconds: number | undefined;

  constructor(kind: TrackerErrorKind, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "TrackerApiError";
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface TrackerClient {
  listProjects(): Promise<Project[]>;
  listTasks(slug: string): Promise<TaskListItem[]>;
  getTask(slug: string, key: string): Promise<TaskDetail>;
  /** Needs a write token, like every method below. */
  createTask(slug: string, input: NewTaskInput): Promise<TaskDetail>;
  updateTask(slug: string, key: string, changes: TaskChanges): Promise<TaskDetail>;
  addDependency(slug: string, key: string, dependsOnKey: string): Promise<TaskLink>;
  removeDependency(slug: string, key: string, dependsOnKey: string): Promise<void>;
}

export interface TrackerClientOptions {
  /** Base URL without a trailing slash requirement (a path prefix is kept). */
  apiUrl: string;
  token: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 10_000;

type RequestContext = { slug?: string; key?: string; dependsOnKey?: string; write?: boolean };

interface ErrorBody {
  code: string | undefined;
  unknownKeys: string[];
  pendingDependencies: string[];
}

const strings = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);

const errorBody = async (response: Response): Promise<ErrorBody> => {
  try {
    const body = (await response.json()) as Record<string, unknown> | null;
    const code = body?.error;
    return {
      code: typeof code === "string" ? code : undefined,
      unknownKeys: strings(body?.unknownKeys),
      pendingDependencies: strings(body?.pendingDependencies),
    };
  } catch {
    return { code: undefined, unknownKeys: [], pendingDependencies: [] };
  }
};

const FORBIDDEN_WRITE =
  "Not allowed (403 forbidden): changing a task's status needs the token's creator (or owner) to be its assignee " +
  "or an admin, and that user must still have access to the project.";

const withCode = (status: number, code: string | undefined) => (code ? `${status} ${code}` : `${status}`);

export function createTrackerClient({
  apiUrl,
  token,
  fetch = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: TrackerClientOptions): TrackerClient {
  const base = apiUrl.replace(/\/+$/, "");
  const redact = (text: string) => text.split(token).join("[redacted]");

  async function failure(response: Response, context: RequestContext): Promise<TrackerApiError> {
    const { code, unknownKeys, pendingDependencies } = await errorBody(response);
    switch (response.status) {
      case 400:
      case 409: {
        if (!context.write) break;
        const details = [
          unknownKeys.length > 0 ? ` Unknown task keys: ${unknownKeys.join(", ")}.` : "",
          pendingDependencies.length > 0 ? ` Pending dependencies: ${pendingDependencies.join(", ")}.` : "",
        ].join("");
        return new TrackerApiError(
          "rejected",
          `The Task Tracker API refused the change (${withCode(response.status, code)}).${details}`,
        );
      }
      case 401:
        return new TrackerApiError("unauthorized", `The token is invalid, expired or revoked (${withCode(401, code)}).`);
      case 403:
        if (context.write && code === "token_not_allowed") return new TrackerApiError("read_only", READ_ONLY_TOKEN_MESSAGE);
        if (context.write && code === "forbidden") return new TrackerApiError("forbidden", FORBIDDEN_WRITE);
        if (code === "forbidden" && context.slug !== undefined) {
          return new TrackerApiError(
            "forbidden",
            `The owner of this personal token cannot access project "${context.slug}" (403 forbidden). ` +
              "Use list_projects to see the projects it can access.",
          );
        }
        return new TrackerApiError(
          "forbidden",
          `The token is not allowed to call this endpoint (${withCode(403, code)}).`,
        );
      case 404:
        if (code === "dependency_not_found" && context.dependsOnKey !== undefined) {
          return new TrackerApiError(
            "not_found",
            `${context.key} does not depend on ${context.dependsOnKey} in project "${context.slug}".`,
          );
        }
        if (code === "task_not_found" && context.key !== undefined) {
          return new TrackerApiError("not_found", `Task "${context.key}" was not found in project "${context.slug}".`);
        }
        if (context.slug !== undefined) {
          return new TrackerApiError(
            "not_found",
            `Project "${context.slug}" was not found (or is not visible to this token).`,
          );
        }
        return new TrackerApiError("not_found", `Not found (${withCode(404, code)}).`);
      case 429: {
        const header = response.headers.get("retry-after");
        const seconds = header !== null && /^\d+$/.test(header.trim()) ? Number(header.trim()) : undefined;
        const when = seconds === undefined ? "retry in a minute" : `retry after ${seconds} seconds`;
        return new TrackerApiError("rate_limited", `Rate limited by the Task Tracker API; ${when}.`, seconds);
      }
    }
    return new TrackerApiError("http", `The Task Tracker API answered HTTP ${response.status}.`);
  }

  async function request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    { body, ...context }: RequestContext & { body?: unknown } = {},
  ): Promise<T> {
    const signal = AbortSignal.timeout(timeoutMs);
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal.aborted) {
        throw new TrackerApiError(
          "unreachable",
          `The Task Tracker API at ${base} did not respond within ${timeoutMs / 1000} seconds.`,
        );
      }
      const reason = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : "";
      throw new TrackerApiError(
        "unreachable",
        redact(`The Task Tracker API at ${base} is unreachable${reason ? ` (${reason})` : ""}.`),
      );
    }
    if (!response.ok) throw await failure(response, { ...context, write: method !== "GET" });
    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch {
      throw new TrackerApiError("http", "The Task Tracker API answered with invalid JSON.");
    }
  }

  const segment = encodeURIComponent;
  const tasksPath = (slug: string) => `/api/projects/${segment(slug)}/tasks`;
  const taskPath = (slug: string, key: string) => `${tasksPath(slug)}/${segment(key)}`;
  return {
    listProjects: () => request<Project[]>("GET", "/api/projects"),
    listTasks: (slug) => request<TaskListItem[]>("GET", tasksPath(slug), { slug }),
    getTask: (slug, key) => request<TaskDetail>("GET", taskPath(slug, key), { slug, key }),
    createTask: (slug, input) => request<TaskDetail>("POST", tasksPath(slug), { slug, body: input }),
    updateTask: (slug, key, changes) => request<TaskDetail>("PATCH", taskPath(slug, key), { slug, key, body: changes }),
    addDependency: (slug, key, dependsOnKey) =>
      request<TaskLink>("POST", `${taskPath(slug, key)}/dependencies`, { slug, key, body: { dependsOnKey } }),
    removeDependency: (slug, key, dependsOnKey) =>
      request<void>("DELETE", `${taskPath(slug, key)}/dependencies/${segment(dependsOnKey)}`, {
        slug,
        key,
        dependsOnKey,
      }),
  };
}
