import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AppRoutes } from "../../app/AppRoutes.tsx";
import type { ApiToken, CurrentUser } from "../../api/types.ts";
import { admin, me, projects } from "../../test/fixtures.ts";
import { fakeApi, renderRoutes, reply } from "../../test/render.tsx";

const location = () => screen.getByTestId("location").textContent;

const SECRET = `ttk_${"p".repeat(43)}`;

const apiToken = (overrides: Partial<ApiToken> = {}): ApiToken => ({
  id: 1,
  name: "Laptop",
  prefix: "abcdefgh",
  scope: "read",
  createdAt: "2026-10-01T15:00:00.000Z",
  createdBy: "annamiller",
  lastUsedAt: "2026-10-05T10:00:00.000Z",
  expiresAt: "2026-12-30T15:00:00.000Z",
  revokedAt: null,
  status: "active",
  ...overrides,
});

function setup(user: CurrentUser, overrides: Record<string, unknown> = {}) {
  let tokens: ApiToken[] = [apiToken()];
  const api = fakeApi({
    "GET /auth/me": user,
    "GET /api/projects": projects,
    "GET /api/account/tokens": () => tokens,
    "POST /api/account/tokens": ({ body }: { body: unknown }) => {
      const { name, scope } = body as { name: string; scope: ApiToken["scope"] };
      const created = apiToken({ id: 2, name, scope, prefix: "pppppppp", lastUsedAt: null });
      tokens = [created, ...tokens];
      return reply(201, { token: SECRET, ...created });
    },
    "DELETE /api/account/tokens/1": () => {
      tokens = tokens.map((t) => (t.id === 1 ? { ...t, status: "revoked", revokedAt: "2026-10-10T10:00:00.000Z" } : t));
      return reply(204);
    },
    ...overrides,
  });
  return { api, ...renderRoutes(<AppRoutes />, "/account/tokens"), user: userEvent.setup() };
}

const section = () => screen.findByRole("region", { name: "API tokens" });

describe("personal API tokens page", () => {
  it("is reached from the account menu", async () => {
    fakeApi({ "GET /auth/me": me, "GET /api/projects": projects, "GET /api/projects/app/tasks": [], "GET /api/account/tokens": [] });
    renderRoutes(<AppRoutes />, "/projects/app");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Account menu for annamiller" }));
    await user.click(screen.getByRole("link", { name: "API tokens" }));

    expect(location()).toBe("/account/tokens");
    expect(await screen.findByRole("heading", { level: 1, name: "Personal API tokens" })).toBeInTheDocument();
  });

  it("lists the user's tokens and explains they work with every project they can access", async () => {
    setup(me);
    const region = await section();
    expect(region).toHaveTextContent("Works with every project you can access.");
    const [row] = await within(region).findAllByRole("listitem");
    expect(row).toHaveTextContent("Laptop");
    expect(row).toHaveTextContent("ttk_abcdefgh…");
    expect(row).toHaveTextContent("Read only");
    expect(row).toHaveTextContent("Last used Oct 5, 2026");
    expect(row).toHaveTextContent("Expires Dec 30, 2026");
    expect(row).toHaveTextContent("Active");
  });

  it("gives members read-only tokens without an access choice", async () => {
    const { api, user } = setup(me);
    const region = await section();
    expect(within(region).queryByRole("radiogroup", { name: "Access" })).not.toBeInTheDocument();
    expect(region).toHaveTextContent("Personal tokens of members are read only.");

    await user.type(within(region).getByRole("textbox", { name: "Token name" }), "Agent");
    await user.click(within(region).getByRole("button", { name: "Create token" }));

    await waitFor(() =>
      expect(api.calls).toContainEqual({
        route: "POST /api/account/tokens",
        body: { name: "Agent", expiresInDays: 90, scope: "read" },
      }),
    );
  });

  it("lets admins choose read & write access", async () => {
    const { api, user } = setup(admin);
    const region = await section();
    expect(region).not.toHaveTextContent("Personal tokens of members are read only.");
    const access = within(region).getByRole("radiogroup", { name: "Access" });
    expect(within(access).getByRole("radio", { name: "Read only" })).toBeChecked();

    await user.click(within(access).getByRole("radio", { name: "Read & write" }));
    expect(region).toHaveTextContent("This token can create and edit tasks and their dependencies as you");
    await user.type(within(region).getByRole("textbox", { name: "Token name" }), "Agent");
    await user.click(within(region).getByRole("button", { name: "Create token" }));

    await waitFor(() =>
      expect(api.calls).toContainEqual({
        route: "POST /api/account/tokens",
        body: { name: "Agent", expiresInDays: 90, scope: "write" },
      }),
    );
  });

  it("shows a new token's secret once, with a usage hint across projects", async () => {
    const { user, queryClient } = setup(me);
    const region = await section();
    await user.type(within(region).getByRole("textbox", { name: "Token name" }), "CI bot");
    await user.click(within(region).getByRole("button", { name: "Create token" }));

    const dialog = await screen.findByRole("dialog", { name: "Token for CI bot created" });
    expect(dialog).toHaveTextContent(SECRET);
    expect(dialog).toHaveTextContent(
      `curl -H "Authorization: Bearer $TRACKER_API_TOKEN" ${window.location.origin}/api/projects`,
    );
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(JSON.stringify(queryClient.getMutationCache().getAll().map((m) => m.state.data))).not.toContain(SECRET);
    expect(await within(region).findByText("CI bot")).toBeInTheDocument();
  });

  it("explains a refused write token", async () => {
    const { user } = setup(admin, { "POST /api/account/tokens": reply(403, { error: "token_scope_not_allowed" }) });
    const region = await section();
    await user.click(within(region).getByRole("radio", { name: "Read & write" }));
    await user.type(within(region).getByRole("textbox", { name: "Token name" }), "Agent");
    await user.click(within(region).getByRole("button", { name: "Create token" }));
    expect(await within(region).findByRole("alert")).toHaveTextContent("Personal tokens of members are read only.");
  });

  it("asks before revoking a token, then revokes it", async () => {
    const { api, user } = setup(me);
    const region = await section();
    await user.click(await within(region).findByRole("button", { name: "Revoke Laptop" }));

    const dialog = screen.getByRole("alertdialog", { name: "Revoke Laptop?" });
    await user.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(api.calls.map((c) => c.route)).toContain("DELETE /api/account/tokens/1"));
    await waitFor(() => expect(within(region).queryByRole("button", { name: "Revoke Laptop" })).not.toBeInTheDocument());
  });
});
