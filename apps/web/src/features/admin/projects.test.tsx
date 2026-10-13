import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AppRoutes } from "../../app/AppRoutes.tsx";
import { admin, adminProjectDetail, adminProjects, membersOverview, projects } from "../../test/fixtures.ts";
import { fakeApi, renderRoutes, reply } from "../../test/render.tsx";

const location = () => screen.getByTestId("location").textContent;

function setup(overrides: Record<string, unknown> = {}) {
  const api = fakeApi({
    "GET /auth/me": admin,
    "GET /api/projects": projects,
    "GET /api/admin/projects": adminProjects,
    "GET /api/admin/members": membersOverview,
    "POST /api/admin/projects": ({ body }: { body: unknown }) =>
      reply(201, { ...adminProjectDetail(), ...(body as object), id: 9 }),
    "GET /api/admin/projects/mobile": adminProjectDetail({ slug: "mobile", name: "Acme Mobile" }),
    ...overrides,
  });
  return { api, ...renderRoutes(<AppRoutes />, "/admin/projects"), user: userEvent.setup() };
}

describe("Projects", () => {
  it("lists projects as cards with their counts, linking to their settings", async () => {
    setup();
    const card = await screen.findByRole("link", { name: /Acme App/ });
    expect(card).toHaveAttribute("href", "/admin/projects/app");
    expect(card).toHaveTextContent("app");
    expect(card).toHaveTextContent("2 repositories");
    expect(card).toHaveTextContent("7 tasks");
    expect(card).toHaveTextContent("1 member");
    expect(card).toHaveTextContent("Discord linked");

    const other = screen.getByRole("link", { name: /Acme Landing/ });
    expect(other).toHaveTextContent("1 repository");
    expect(other).toHaveTextContent("0 tasks");
    expect(other).toHaveTextContent("0 members");
    expect(other).toHaveTextContent("No Discord channel");
  });

  it("fills the short key and prefix from the name until they are edited", async () => {
    const { user } = setup();
    const form = await screen.findByRole("form", { name: "New project" });
    const name = within(form).getByRole("textbox", { name: "Name" });
    const slug = within(form).getByRole("textbox", { name: "Short key" });
    const prefix = within(form).getByRole("textbox", { name: "Task key prefix" });

    await user.type(name, "Acme Mobile");
    expect(slug).toHaveValue("acme-mobile");
    expect(prefix).toHaveValue("AM");

    await user.clear(slug);
    await user.type(slug, "mobile");
    await user.clear(prefix);
    await user.type(prefix, "mb");
    expect(prefix).toHaveValue("MB");
    await user.type(name, " 2");
    expect(slug).toHaveValue("mobile");
    expect(prefix).toHaveValue("MB");
  });

  it("creates a project and opens its settings", async () => {
    const { api, user } = setup();
    const form = await screen.findByRole("form", { name: "New project" });
    await user.type(within(form).getByRole("textbox", { name: "Name" }), "Acme Mobile");
    await user.clear(within(form).getByRole("textbox", { name: "Short key" }));
    await user.type(within(form).getByRole("textbox", { name: "Short key" }), "mobile");
    await user.type(within(form).getByRole("textbox", { name: /Discord channel ID/ }), "12345678901234567");
    await user.click(within(form).getByRole("button", { name: "Create project" }));

    await waitFor(() =>
      expect(api.calls).toContainEqual({
        route: "POST /api/admin/projects",
        body: { name: "Acme Mobile", slug: "mobile", taskKeyPrefix: "AM", discordChannelId: "12345678901234567" },
      }),
    );
    await waitFor(() => expect(location()).toBe("/admin/projects/mobile"));
  });

  it("validates the fields before asking the server", async () => {
    const { api, user } = setup();
    const form = await screen.findByRole("form", { name: "New project" });
    await user.click(within(form).getByRole("button", { name: "Create project" }));

    const name = within(form).getByRole("textbox", { name: "Name" });
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Give the project a name.");
    expect(name).toHaveFocus();
    expect(api.calls.map((c) => c.route)).not.toContain("POST /api/admin/projects");
  });

  it("shows the server's reason when creation fails", async () => {
    const { user } = setup({ "POST /api/admin/projects": reply(409, { error: "slug_taken" }) });
    const form = await screen.findByRole("form", { name: "New project" });
    await user.type(within(form).getByRole("textbox", { name: "Name" }), "App");
    await user.click(within(form).getByRole("button", { name: "Create project" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Another project already uses that short key.");
    expect(location()).toBe("/admin/projects");
  });

  it("shows a taken short key or prefix on its field", async () => {
    const { user } = setup({ "POST /api/admin/projects": reply(409, { error: "slug_taken" }) });
    const form = await screen.findByRole("form", { name: "New project" });
    await user.type(within(form).getByRole("textbox", { name: "Name" }), "App");
    await user.click(within(form).getByRole("button", { name: "Create project" }));

    const slug = within(form).getByRole("textbox", { name: "Short key" });
    await waitFor(() => expect(slug).toHaveAttribute("aria-invalid", "true"));
    expect(slug).toHaveAccessibleDescription(expect.stringContaining("Another project already uses that short key."));
    expect(within(form).getByRole("textbox", { name: "Task key prefix" })).not.toHaveAttribute("aria-invalid");
  });

  it("clears a stale server error when a field changes and shows only the latest one", async () => {
    const errors = ["prefix_taken", "slug_taken"];
    const { user } = setup({ "POST /api/admin/projects": () => reply(409, { error: errors.shift() }) });
    const form = await screen.findByRole("form", { name: "New project" });
    const name = within(form).getByRole("textbox", { name: "Name" });
    const slug = within(form).getByRole("textbox", { name: "Short key" });
    const prefix = within(form).getByRole("textbox", { name: "Task key prefix" });
    await user.type(name, "App");
    await user.click(within(form).getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(prefix).toHaveAttribute("aria-invalid", "true"));
    expect(prefix).toHaveAccessibleDescription(expect.stringContaining("Another project already uses that prefix."));

    await user.type(prefix, "X");
    expect(prefix).not.toHaveAttribute("aria-invalid");
    expect(within(form).queryByRole("alert")).not.toBeInTheDocument();

    await user.click(within(form).getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(slug).toHaveAttribute("aria-invalid", "true"));
    expect(prefix).not.toHaveAttribute("aria-invalid");
    expect(within(form).getAllByRole("alert")).toHaveLength(1);
  });
});
