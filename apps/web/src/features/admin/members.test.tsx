import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AppRoutes } from "../../app/AppRoutes.tsx";
import type { MembersOverview } from "../../api/types.ts";
import { admin, me, membersOverview, projects } from "../../test/fixtures.ts";
import { fakeApi, renderRoutes, reply } from "../../test/render.tsx";

const location = () => screen.getByTestId("location").textContent;

function setup(route = "/admin/members", overrides: Record<string, unknown> = {}) {
  let overview: MembersOverview = membersOverview;
  const api = fakeApi({
    "GET /auth/me": admin,
    "GET /api/projects": projects,
    "GET /api/admin/members": () => overview,
    "GET /api/admin/projects": [],
    "POST /api/admin/members": ({ body }: { body: unknown }) => {
      const githubLogin = (body as { githubLogin: string }).githubLogin;
      const member = { githubLogin, createdAt: "2026-10-09T16:00:00.000Z", addedBy: "boss" };
      overview = { ...overview, members: [...overview.members, member] };
      return reply(201, member);
    },
    "DELETE /api/admin/members/juanperez": () => {
      overview = { ...overview, members: overview.members.filter((m) => m.githubLogin !== "juanperez") };
      return reply(204);
    },
    ...overrides,
  });
  return { api, ...renderRoutes(<AppRoutes />, route), user: userEvent.setup() };
}

describe("Admin layout", () => {
  it("opens Members from /admin, marking the current section", async () => {
    setup("/admin");
    expect(await screen.findByRole("heading", { level: 1, name: "Members" })).toBeInTheDocument();
    expect(location()).toBe("/admin/members");
    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    expect(within(nav).getByRole("link", { name: "Members" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Projects" })).not.toHaveAttribute("aria-current");
  });

  it("sends unknown admin URLs to Members", async () => {
    setup("/admin/nope/deeper");
    expect(await screen.findByRole("heading", { level: 1, name: "Members" })).toBeInTheDocument();
    expect(location()).toBe("/admin/members");
  });

  it("switches to Projects", async () => {
    const { user } = setup();
    const nav = await screen.findByRole("navigation", { name: "Admin sections" });
    await user.click(within(nav).getByRole("link", { name: "Projects" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Projects" })).toBeInTheDocument();
    expect(location()).toBe("/admin/projects");
  });

  it("keeps members out", async () => {
    setup("/admin/members", { "GET /auth/me": me });
    await waitFor(() => expect(location()).not.toMatch(/^\/admin/));
  });
});

describe("Members", () => {
  it("shows configured admins read-only", async () => {
    setup();
    const admins = await screen.findByRole("region", { name: "Admins" });
    expect(admins).toHaveTextContent("@boss");
    expect(admins).toHaveTextContent("ADMIN_GITHUB_LOGINS");
    expect(within(admins).queryByRole("button")).not.toBeInTheDocument();
  });

  it("lists members with who added them and when", async () => {
    setup();
    const section = await screen.findByRole("region", { name: "Members (2)" });
    const rows = await within(section).findAllByRole("row");
    expect(rows[1]).toHaveTextContent("@juanperez");
    expect(rows[1]).toHaveTextContent("@boss");
    expect(rows[1]).toHaveTextContent("Oct 9, 2026");
    expect(rows[2]).toHaveTextContent("@maria-dev");
    expect(within(rows[2]!).getByRole("button", { name: "Remove @maria-dev" })).toBeInTheDocument();
  });

  it("adds a member, accepting a leading @", async () => {
    const { api, user } = setup();
    const input = await screen.findByRole("textbox", { name: "Add a member" });
    expect(input).toHaveAccessibleDescription(/Their GitHub username/);
    await user.type(input, "@Carlos-QA");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    await waitFor(() =>
      expect(api.calls).toContainEqual({ route: "POST /api/admin/members", body: { githubLogin: "carlos-qa" } }),
    );
    expect(await screen.findByRole("region", { name: "Members (3)" })).toHaveTextContent("@carlos-qa");
    expect(input).toHaveValue("");
  });

  it("validates the username before asking the server", async () => {
    const { api, user } = setup();
    const input = await screen.findByRole("textbox", { name: "Add a member" });
    await user.type(input, "carlos_qa");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(screen.getByRole("alert")).toHaveTextContent("That isn’t a valid GitHub username.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveFocus();
    expect(api.calls.map((c) => c.route)).not.toContain("POST /api/admin/members");
  });

  it("shows the server's reason when adding fails", async () => {
    const { user } = setup("/admin/members", {
      "POST /api/admin/members": reply(409, { error: "already_member" }),
    });
    await user.type(await screen.findByRole("textbox", { name: "Add a member" }), "juanperez");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That person is already a member.");
  });

  it("asks for confirmation before removing a member", async () => {
    const { api, user } = setup();
    const opener = await screen.findByRole("button", { name: "Remove @juanperez" });
    await user.click(opener);

    const dialog = screen.getByRole("alertdialog", { name: "Remove @juanperez?" });
    expect(dialog).toHaveAccessibleDescription("They’ll be signed out and their open tasks unassigned.");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(api.calls.map((c) => c.route)).not.toContain("DELETE /api/admin/members/juanperez");

    await user.click(opener);
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove" }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(api.calls.map((c) => c.route)).toContain("DELETE /api/admin/members/juanperez");
    expect(await screen.findByRole("region", { name: "Members (1)" })).not.toHaveTextContent("@juanperez");
    // The removed row's button is gone, so focus lands on the members heading instead of the page.
    await waitFor(() => expect(screen.getByRole("heading", { name: "Members (1)" })).toHaveFocus());
  });

  it("keeps the dialog open with the reason when removing fails", async () => {
    const { user } = setup("/admin/members", {
      "DELETE /api/admin/members/juanperez": reply(500, { error: "internal_error" }),
    });
    await user.click(await screen.findByRole("button", { name: "Remove @juanperez" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
  });
});
