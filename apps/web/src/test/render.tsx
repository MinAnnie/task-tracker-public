import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { vi } from "vitest";
import { createQueryClient } from "../app/query-client.ts";

const REPLY = Symbol("reply");
type Reply = { [REPLY]: true; status: number; body?: unknown };
type Handler = (request: { body: unknown }) => Reply | unknown;

export interface FakeApi {
  /** Every request made, in order, as "METHOD /path" plus its parsed JSON body. */
  calls: { route: string; body: unknown }[];
  /** Adds or replaces the handler of "METHOD /path". */
  on: (route: string, handler: Handler | unknown) => void;
}

export const reply = (status: number, body?: unknown): Reply => ({ [REPLY]: true, status, body });

const isReply = (value: unknown): value is Reply => typeof value === "object" && value !== null && REPLY in value;

/**
 * Stubs `fetch` with an in-memory router keyed by "METHOD /path". A handler is a
 * value (answered with 200) or a function of the request; `reply(status, body)`
 * sets the status. Unknown routes answer 404 `not_stubbed`.
 */
export function fakeApi(routes: Record<string, Handler | unknown> = {}): FakeApi {
  const handlers = new Map(Object.entries(routes));
  const calls: FakeApi["calls"] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const route = `${init.method ?? "GET"} ${new URL(input, "http://localhost").pathname}`;
      const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ route, body });

      const handler = handlers.get(route);
      const result = typeof handler === "function" ? (handler as Handler)({ body }) : handler;
      const { status, body: payload } =
        handler === undefined ? reply(404, { error: "not_stubbed" }) : isReply(result) ? result : reply(200, result);
      if (status === 204 || payload === undefined) return new Response(null, { status });
      return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
    }),
  );

  return { calls, on: (route, handler) => handlers.set(route, handler) };
}

/** Renders the current location so tests can assert on navigation. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

interface RenderOptions {
  /** Initial URL. */
  route?: string;
  /** Route pattern `ui` is mounted at (for `useParams`). */
  path?: string;
}

export function renderWithProviders(ui: ReactElement, { route = "/", path = "*" }: RenderOptions = {}) {
  const queryClient = createQueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={ui} />
          <Route path="*" element={null} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

/** Renders a full route tree (e.g. the whole app) inside the providers. */
export function renderRoutes(routes: ReactElement, route = "/") {
  const queryClient = createQueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        {routes}
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}
