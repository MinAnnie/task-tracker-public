import type { Project, TaskDetail, TaskListItem } from "./types.ts";

export type TrackerErrorKind = "unauthorized" | "forbidden" | "not_found" | "rate_limited" | "unreachable" | "http";

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
}

export interface TrackerClientOptions {
  /** Base URL without a trailing slash requirement (a path prefix is kept). */
  apiUrl: string;
  token: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 10_000;

type NotFoundContext = { slug?: string; key?: string };

const errorCode = async (response: Response): Promise<string | undefined> => {
  try {
    const body: unknown = await response.json();
    const code = (body as { error?: unknown } | null)?.error;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
};

const withCode = (status: number, code: string | undefined) => (code ? `${status} ${code}` : `${status}`);

export function createTrackerClient({
  apiUrl,
  token,
  fetch = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: TrackerClientOptions): TrackerClient {
  const base = apiUrl.replace(/\/+$/, "");
  const redact = (text: string) => text.split(token).join("[redacted]");

  async function failure(response: Response, context: NotFoundContext): Promise<TrackerApiError> {
    const code = await errorCode(response);
    switch (response.status) {
      case 401:
        return new TrackerApiError("unauthorized", `The token is invalid, expired or revoked (${withCode(401, code)}).`);
      case 403:
        return new TrackerApiError(
          "forbidden",
          `The token is not allowed to call this endpoint (${withCode(403, code)}).`,
        );
      case 404:
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
      default:
        return new TrackerApiError("http", `The Task Tracker API answered HTTP ${response.status}.`);
    }
  }

  async function get<T>(path: string, context: NotFoundContext = {}): Promise<T> {
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
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
    if (!response.ok) throw await failure(response, context);
    try {
      return (await response.json()) as T;
    } catch {
      throw new TrackerApiError("http", "The Task Tracker API answered with invalid JSON.");
    }
  }

  const segment = encodeURIComponent;
  return {
    listProjects: () => get<Project[]>("/api/projects"),
    listTasks: (slug) => get<TaskListItem[]>(`/api/projects/${segment(slug)}/tasks`, { slug }),
    getTask: (slug, key) => get<TaskDetail>(`/api/projects/${segment(slug)}/tasks/${segment(key)}`, { slug, key }),
  };
}
