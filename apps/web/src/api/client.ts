/** A failed API call: `code` is the server's `error` field (or a client-side code). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Keys of unfinished dependencies, sent with `dependencies_pending`. */
  readonly pendingDependencies: readonly string[];

  constructor(status: number, code: string, pendingDependencies: readonly string[] = []) {
    super(`API error ${status}: ${code}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.pendingDependencies = pendingDependencies;
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

async function readErrorBody(response: Response): Promise<{ code: string; pending: string[] }> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null) {
      const { error, pendingDependencies } = body as Record<string, unknown>;
      return {
        code: typeof error === "string" ? error : "unknown_error",
        pending: Array.isArray(pendingDependencies) ? pendingDependencies.map(String) : [],
      };
    }
  } catch {
    // Not JSON (e.g. a proxy error page).
  }
  return { code: "unknown_error", pending: [] };
}

/**
 * Calls the same-origin API. Mutations always declare a JSON body: the server
 * rejects mutations without it as a CSRF defense, even the bodyless ones.
 */
export async function apiRequest<T>(path: string, { method = "GET", body }: RequestOptions = {}): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: { accept: "application/json" } };
  if (method !== "GET") {
    init.headers = { accept: "application/json", "content-type": "application/json" };
    if (body !== undefined) init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, "network_error");
  }

  if (!response.ok) {
    const { code, pending } = await readErrorBody(response);
    throw new ApiError(response.status, code, pending);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
