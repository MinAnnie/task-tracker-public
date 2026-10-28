import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AppRoutes } from "../../app/AppRoutes.tsx";
import type { AdminProjectDetail, ApiToken, Stage } from "../../api/types.ts";
import { admin, adminProjectDetail, adminProjects, membersOverview, projects } from "../../test/fixtures.ts";
import { fakeApi, renderRoutes, reply } from "../../test/render.tsx";

const location = () => screen.getByTestId("location").textContent;

const SECRET = `ttk_${"s".repeat(43)}`;

const apiToken = (overrides: Partial<ApiToken> = {}): ApiToken => ({
  id: 1,
  name: "VPS agent",
  prefix: "abcdefgh",
  scope: "read",
  createdAt: "2026-10-01T15:00:00.000Z",
  createdBy: "octocat",
  lastUsedAt: null,
  expiresAt: "2026-12-30T15:00:00.000Z",
  revokedAt: null,
  status: "active",
  ...overrides,
});

/** Admin stage routes over an in-memory list, renumbering positions like the server. */
function stageRoutes(initial: string[]) {
  let stages: Stage[] = initial.map((name, position) => ({ id: position + 1, name, position }));
  const renumber = (list: Stage[]) => (stages = list.map((stage, position) => ({ ...stage, position })));
  const routes: Record<string, unknown> = {
    "GET /api/admin/projects/app/stages": () => stages,
    "POST /api/admin/projects/app/stages": ({ body }: { body: unknown }) => {
      const stage = { id: stages.length + 10, name: (body as { name: string }).name, position: stages.length };
      stages = [...stages, stage];
      return reply(201, stage);
    },
  };
  for (const id of initial.keys()) {
    const stageId = id + 1;
    routes[`PATCH /api/admin/projects/app/stages/${stageId}`] = ({ body }: { body: unknown }) => {
      const { name, position } = body as { name?: string; position?: number };
      const stage = stages.find((s) => s.id === stageId)!;
      const renamed = { ...stage, name: name ?? stage.name };
      const others = stages.filter((s) => s.id !== stageId);
      const at = position ?? stages.indexOf(stage);
      renumber([...others.slice(0, at), renamed, ...others.slice(at)]);
      return stages.find((s) => s.id === stageId);
    };
    routes[`DELETE /api/admin/projects/app/stages/${stageId}`] = () => {
      renumber(stages.filter((s) => s.id !== stageId));
      return reply(204);
    };
  }
  return routes;
}

function setup(overrides: Record<string, unknown> = {}) {
  let detail: AdminProjectDetail = adminProjectDetail();
  let tokens: ApiToken[] = [
    apiToken(),
    apiToken({
      id: 2,
      name: "Old script",
      prefix: "zyxwvuts",
      scope: "write",
      lastUsedAt: "2026-10-05T10:00:00.000Z",
      expiresAt: null,
      revokedAt: "2026-10-06T10:00:00.000Z",
      status: "revoked",
    }),
  ];
  const api = fakeApi({
    "GET /auth/me": admin,
    "GET /api/projects": projects,
    "GET /api/admin/projects": adminProjects,
    "GET /api/admin/members": {
      ...membersOverview,
      members: [...membersOverview.members, { githubLogin: "carlos-qa", createdAt: "2026-10-09T15:00:00.000Z", addedBy: null }],
    },
    "GET /api/admin/projects/app": () => detail,
    "PATCH /api/admin/projects/app": ({ body }: { body: unknown }) => {
      detail = { ...detail, ...(body as object) };
      return detail;
    },
    "POST /api/admin/projects/app/members": ({ body }: { body: unknown }) => {
      const member = { githubLogin: (body as { githubLogin: string }).githubLogin, createdAt: "2026-10-09T16:00:00.000Z" };
      detail = { ...detail, members: [...detail.members, member] };
      return reply(201, member);
    },
    "DELETE /api/admin/projects/app/members/juanperez": () => {
      detail = { ...detail, members: [] };
      return reply(204);
    },
    "POST /api/admin/projects/app/repositories": ({ body }: { body: unknown }) => {
      const repository = { fullName: (body as { fullName: string }).fullName, githubInstallationId: null };
      detail = { ...detail, repositories: [...detail.repositories, repository] };
      return reply(201, repository);
    },
    "DELETE /api/admin/projects/app/repositories/acme/app-web": () => {
      detail = { ...detail, repositories: [] };
      return reply(204);
    },
    "DELETE /api/admin/projects/app": reply(204),
    "GET /api/admin/projects/app/tokens": () => tokens,
    "POST /api/admin/projects/app/tokens": ({ body }: { body: unknown }) => {
      const created = apiToken({ id: 3, name: (body as { name: string }).name, prefix: "ssssssss" });
      tokens = [created, ...tokens];
      return reply(201, { token: SECRET, ...created });
    },
    "DELETE /api/admin/projects/app/tokens/1": () => {
      tokens = tokens.map((t) => (t.id === 1 ? { ...t, status: "revoked", revokedAt: "2026-10-10T10:00:00.000Z" } : t));
      return reply(204);
    },
    ...stageRoutes(["Backend", "Frontend", "QA"]),
    ...overrides,
  });
  return { api, ...renderRoutes(<AppRoutes />, "/admin/projects/app"), user: userEvent.setup() };
}

describe("Project settings", () => {
  it("shows the project with a way back to all projects", async () => {
    setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Acme App" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All projects" })).toHaveAttribute("href", "/admin/projects");
    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    expect(within(nav).getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
  });

  it("explains an unknown project", async () => {
    setup({ "GET /api/admin/projects/app": reply(404, { error: "project_not_found" }) });
    expect(await screen.findByRole("alert")).toHaveTextContent("This project doesn’t exist");
  });

  describe("General", () => {
    it("saves the changed fields", async () => {
      const { api, user } = setup();
      const form = await screen.findByRole("form", { name: "General" });
      const name = within(form).getByRole("textbox", { name: "Name" });
      await waitFor(() => expect(name).toHaveValue("Acme App"));
      expect(within(form).getByRole("textbox", { name: "Short key" })).toHaveValue("app");
      expect(within(form).getByRole("textbox", { name: "Task key prefix" })).toHaveValue("RF");
      expect(within(form).getByRole("textbox", { name: "Discord channel ID" })).toHaveValue("1234567890123456789");

      await user.clear(name);
      await user.type(name, "Acme Web");
      await user.clear(within(form).getByRole("textbox", { name: "Discord channel ID" }));
      await user.click(within(form).getByRole("button", { name: "Save changes" }));

      await waitFor(() =>
        expect(api.calls).toContainEqual({
          route: "PATCH /api/admin/projects/app",
          body: { name: "Acme Web", discordChannelId: null },
        }),
      );
      expect(await within(form).findByRole("status")).toHaveTextContent("Saved.");
      expect(location()).toBe("/admin/projects/app");
    });

    it("saves, clears and validates the Discord server invite", async () => {
      const { api, user } = setup();
      const form = await screen.findByRole("form", { name: "General" });
      const invite = within(form).getByRole("textbox", { name: "Discord server invite" });
      await waitFor(() => expect(invite).toHaveValue("https://discord.gg/acme"));

      await user.clear(invite);
      await user.type(invite, "https://example.com/x");
      await user.click(within(form).getByRole("button", { name: "Save changes" }));
      expect(invite).toHaveAccessibleDescription(expect.stringContaining("Paste an invite link like https://discord.gg/abc123."));
      expect(invite).toHaveFocus();
      expect(api.calls.filter((call) => call.route === "PATCH /api/admin/projects/app")).toEqual([]);

      await user.clear(invite);
      await user.type(invite, "https://discord.com/invite/new-one");
      await user.click(within(form).getByRole("button", { name: "Save changes" }));
      await waitFor(() =>
        expect(api.calls).toContainEqual({
          route: "PATCH /api/admin/projects/app",
          body: { discordInviteUrl: "https://discord.com/invite/new-one" },
        }),
      );

      await user.clear(invite);
      await user.click(within(form).getByRole("button", { name: "Save changes" }));
      await waitFor(() =>
        expect(api.calls).toContainEqual({ route: "PATCH /api/admin/projects/app", body: { discordInviteUrl: null } }),
      );
    });

    it("shows the server refusal of an invite on its field", async () => {
      const { user } = setup({
        "PATCH /api/admin/projects/app": reply(400, { error: "invalid_discord_invite_url" }),
      });
      const form = await screen.findByRole("form", { name: "General" });
      const invite = within(form).getByRole("textbox", { name: "Discord server invite" });
      await waitFor(() => expect(invite).toHaveValue("https://discord.gg/acme"));
      await user.clear(invite);
      await user.type(invite, "https://discord.gg/other");
      await user.click(within(form).getByRole("button", { name: "Save changes" }));
      expect(await within(form).findByText("Paste an invite link like https://discord.gg/abc123.")).toBeInTheDocument();
    });

    it("moves to the new URL when the short key changes", async () => {
      const { user } = setup({
        "PATCH /api/admin/projects/app": adminProjectDetail({ slug: "web" }),
        "GET /api/admin/projects/web": adminProjectDetail({ slug: "web" }),
      });
      const form = await screen.findByRole("form", { name: "General" });
      const slug = within(form).getByRole("textbox", { name: "Short key" });
      await waitFor(() => expect(slug).toHaveValue("app"));
      await user.clear(slug);
      await user.type(slug, "web");
      await user.click(within(form).getByRole("button", { name: "Save changes" }));
      await waitFor(() => expect(location()).toBe("/admin/projects/web"));
    });

    it("explains why the prefix can't change", async () => {
      const { user } = setup({ "PATCH /api/admin/projects/app": reply(409, { error: "prefix_locked" }) });
      const form = await screen.findByRole("form", { name: "General" });
      const prefix = within(form).getByRole("textbox", { name: "Task key prefix" });
      await waitFor(() => expect(prefix).toHaveValue("RF"));
      await user.clear(prefix);
      await user.type(prefix, "AP");
      await user.click(within(form).getByRole("button", { name: "Save changes" }));
      expect(await within(form).findByRole("alert")).toHaveTextContent(
        "The prefix can’t change once the project has tasks.",
      );
      expect(prefix).toHaveAttribute("aria-invalid", "true");
      expect(prefix).toHaveAccessibleDescription(
        expect.stringContaining("The prefix can’t change once the project has tasks."),
      );
    });

    it("shows a taken short key on its field and clears it when the field changes", async () => {
      const { user } = setup({ "PATCH /api/admin/projects/app": reply(409, { error: "slug_taken" }) });
      const form = await screen.findByRole("form", { name: "General" });
      const slug = within(form).getByRole("textbox", { name: "Short key" });
      await waitFor(() => expect(slug).toHaveValue("app"));
      await user.clear(slug);
      await user.type(slug, "web");
      await user.click(within(form).getByRole("button", { name: "Save changes" }));

      await waitFor(() => expect(slug).toHaveAttribute("aria-invalid", "true"));
      expect(slug).toHaveAccessibleDescription(expect.stringContaining("Another project already uses that short key."));

      await user.type(slug, "2");
      expect(slug).not.toHaveAttribute("aria-invalid");
      expect(within(form).queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("Project members", () => {
    it("adds an app member who isn't in the project yet", async () => {
      const { api, user } = setup();
      const section = await screen.findByRole("region", { name: "Project members" });
      expect(await within(section).findByText("@juanperez")).toBeInTheDocument();
      const select = within(section).getByRole("combobox", { name: "Add to project" });
      await waitFor(() =>
        expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
          "Choose a member…",
          "@maria-dev",
          "@carlos-qa",
        ]),
      );

      await user.selectOptions(select, "@carlos-qa");
      await user.click(within(section).getByRole("button", { name: "Add" }));
      await waitFor(() =>
        expect(api.calls).toContainEqual({
          route: "POST /api/admin/projects/app/members",
          body: { githubLogin: "carlos-qa" },
        }),
      );
      expect(await within(section).findByText("@carlos-qa")).toBeInTheDocument();
    });

    it("asks before removing someone, explaining their tasks get unassigned", async () => {
      const { api, user } = setup();
      const section = await screen.findByRole("region", { name: "Project members" });
      await user.click(await within(section).findByRole("button", { name: "Remove @juanperez from this project" }));

      const dialog = screen.getByRole("alertdialog", { name: "Remove @juanperez from Acme App?" });
      expect(dialog).toHaveAccessibleDescription(
        "They’ll lose access to its board, and their open tasks in this project will be unassigned.",
      );
      await user.click(within(dialog).getByRole("button", { name: "Remove" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(api.calls.map((c) => c.route)).toContain("DELETE /api/admin/projects/app/members/juanperez");
      expect(await within(section).findByText("No members yet. Admins always have access.")).toBeInTheDocument();
      await waitFor(() => expect(within(section).getByRole("heading", { name: "Project members" })).toHaveFocus());
    });
  });

  describe("Repositories", () => {
    it("adds a repository", async () => {
      const { api, user } = setup();
      const section = await screen.findByRole("region", { name: "GitHub repositories" });
      expect(await within(section).findByText("acme/app-web")).toBeInTheDocument();
      await user.type(within(section).getByRole("textbox", { name: "Add repository" }), "acme/shop");
      await user.click(within(section).getByRole("button", { name: "Add" }));
      await waitFor(() =>
        expect(api.calls).toContainEqual({
          route: "POST /api/admin/projects/app/repositories",
          body: { fullName: "acme/shop" },
        }),
      );
      expect(await within(section).findByText("acme/shop")).toBeInTheDocument();
      expect(within(section).getByRole("textbox", { name: "Add repository" })).toHaveValue("");
    });

    it("validates the name before asking the server", async () => {
      const { api, user } = setup();
      const section = await screen.findByRole("region", { name: "GitHub repositories" });
      await user.type(within(section).getByRole("textbox", { name: "Add repository" }), "shop");
      await user.click(within(section).getByRole("button", { name: "Add" }));
      expect(within(section).getByRole("alert")).toHaveTextContent("Enter a repository as owner/repo.");
      expect(api.calls.map((c) => c.route)).not.toContain("POST /api/admin/projects/app/repositories");
    });

    it("shows the server's reason when adding fails", async () => {
      const { user } = setup({
        "POST /api/admin/projects/app/repositories": reply(409, { error: "repository_taken" }),
      });
      const section = await screen.findByRole("region", { name: "GitHub repositories" });
      await user.type(within(section).getByRole("textbox", { name: "Add repository" }), "acme/shop");
      await user.click(within(section).getByRole("button", { name: "Add" }));
      expect(await within(section).findByRole("alert")).toHaveTextContent("A project already has that repository.");
    });

    it("removes a repository", async () => {
      const { api, user } = setup();
      const section = await screen.findByRole("region", { name: "GitHub repositories" });
      await user.click(await within(section).findByRole("button", { name: "Remove acme/app-web" }));
      await waitFor(() =>
        expect(api.calls.map((c) => c.route)).toContain(
          "DELETE /api/admin/projects/app/repositories/acme/app-web",
        ),
      );
      await waitFor(() => expect(within(section).queryByText("acme/app-web")).not.toBeInTheDocument());
    });

    it("shows the webhook URL with a Copy button", async () => {
      const { user } = setup();
      const section = await screen.findByRole("region", { name: "GitHub repositories" });
      const url = `${window.location.origin}/webhooks/github`;
      expect(within(section).getByText(url)).toBeInTheDocument();

      await user.click(within(section).getByRole("button", { name: "Copy webhook URL" }));
      expect(await navigator.clipboard.readText()).toBe(url);
      expect(await within(section).findByText("Copied")).toBeInTheDocument();
    });
  });

  describe("Stages", () => {
    const section = () => screen.findByRole("region", { name: "Stages" });
    const stageNames = (region: HTMLElement) =>
      within(within(region).getByRole("list")).getAllByRole("listitem").map((item) => item.querySelector("[data-stage-name]")?.textContent);

    it("lists the stages in order and adds one at the end", async () => {
      const { api, user } = setup();
      const region = await section();
      await waitFor(() => expect(stageNames(region)).toEqual(["Backend", "Frontend", "QA"]));

      await user.type(within(region).getByRole("textbox", { name: "Add stage" }), "  Done ");
      await user.click(within(region).getByRole("button", { name: "Add" }));

      await waitFor(() =>
        expect(api.calls).toContainEqual({ route: "POST /api/admin/projects/app/stages", body: { name: "Done" } }),
      );
      await waitFor(() => expect(stageNames(region)).toEqual(["Backend", "Frontend", "QA", "Done"]));
      expect(within(region).getByRole("textbox", { name: "Add stage" })).toHaveValue("");
    });

    it("checks the name before sending it", async () => {
      const { api, user } = setup();
      const region = await section();
      await user.click(within(region).getByRole("button", { name: "Add" }));
      expect(await within(region).findByRole("alert")).toHaveTextContent("Give the stage a name of up to 50 characters.");
      expect(api.calls.map((c) => c.route)).not.toContain("POST /api/admin/projects/app/stages");
    });

    it("shows the server's refusal", async () => {
      const { user } = setup({ "POST /api/admin/projects/app/stages": reply(409, { error: "stage_taken" }) });
      const region = await section();
      await user.type(within(region).getByRole("textbox", { name: "Add stage" }), "qa");
      await user.click(within(region).getByRole("button", { name: "Add" }));
      expect(await within(region).findByRole("alert")).toHaveTextContent("This project already has a stage with that name.");
    });

    it("moves stages up and down, the ends disabled", async () => {
      const { api, user } = setup();
      const region = await section();
      await waitFor(() => expect(stageNames(region)).toEqual(["Backend", "Frontend", "QA"]));
      expect(within(region).getByRole("button", { name: "Move Backend up" })).toBeDisabled();
      expect(within(region).getByRole("button", { name: "Move QA down" })).toBeDisabled();

      await user.click(within(region).getByRole("button", { name: "Move QA up" }));
      await waitFor(() => expect(stageNames(region)).toEqual(["Backend", "QA", "Frontend"]));
      expect(api.calls).toContainEqual({ route: "PATCH /api/admin/projects/app/stages/3", body: { position: 1 } });

      await user.click(within(region).getByRole("button", { name: "Move Backend down" }));
      await waitFor(() => expect(stageNames(region)).toEqual(["QA", "Backend", "Frontend"]));
      expect(api.calls).toContainEqual({ route: "PATCH /api/admin/projects/app/stages/1", body: { position: 1 } });
    });

    it("renames a stage", async () => {
      const { api, user } = setup();
      const region = await section();
      await user.click(await within(region).findByRole("button", { name: "Rename Frontend" }));
      const input = within(region).getByRole("textbox", { name: "New name for Frontend" });
      expect(input).toHaveValue("Frontend");
      expect(input).toHaveFocus();
      await user.clear(input);
      await user.type(input, "Web");
      await user.click(within(region).getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(api.calls).toContainEqual({ route: "PATCH /api/admin/projects/app/stages/2", body: { name: "Web" } }),
      );
      await waitFor(() => expect(stageNames(region)).toEqual(["Backend", "Web", "QA"]));
    });

    it("deletes an unused stage and explains why a used one stays", async () => {
      const { api, user } = setup({
        "DELETE /api/admin/projects/app/stages/2": reply(409, { error: "stage_in_use", taskCount: 3 }),
      });
      const region = await section();
      await user.click(await within(region).findByRole("button", { name: "Delete Frontend" }));
      expect(await within(region).findByRole("alert")).toHaveTextContent(
        "3 tasks are in this stage. Move them to another stage first.",
      );

      await user.click(within(region).getByRole("button", { name: "Delete QA" }));
      await waitFor(() => expect(stageNames(region)).toEqual(["Backend", "Frontend"]));
      expect(api.calls.map((c) => c.route)).toContain("DELETE /api/admin/projects/app/stages/3");
    });
  });

  describe("Delete project", () => {
    it("requires typing the short key, then deletes and goes back to the list", async () => {
      const { api, user } = setup();
      await user.click(await screen.findByRole("button", { name: "Delete project…" }));

      const dialog = screen.getByRole("alertdialog", { name: "Delete Acme App?" });
      const confirm = within(dialog).getByRole("button", { name: "Delete project" });
      expect(confirm).toBeDisabled();
      await user.type(within(dialog).getByRole("textbox", { name: "Type app to confirm" }), "app");
      await user.click(confirm);

      await waitFor(() => expect(location()).toBe("/admin/projects"));
      expect(api.calls.map((c) => c.route)).toContain("DELETE /api/admin/projects/app");
    });
  });

  describe("API tokens", () => {
    const section = () => screen.findByRole("region", { name: "API tokens" });

    it("lists the project's tokens with their prefix, access, dates and status", async () => {
      setup();
      const region = await section();
      const rows = await within(region).findAllByRole("listitem");
      expect(rows).toHaveLength(2);

      expect(rows[0]).toHaveTextContent("VPS agent");
      expect(rows[0]).toHaveTextContent("ttk_abcdefgh…");
      expect(rows[0]).toHaveTextContent("Read only");
      expect(rows[0]).toHaveTextContent("Created Oct 1, 2026 by @octocat");
      expect(rows[0]).toHaveTextContent("Never used");
      expect(rows[0]).toHaveTextContent("Expires Dec 30, 2026");
      expect(rows[0]).toHaveTextContent("Active");
      expect(within(rows[0]!).getByRole("button", { name: "Revoke VPS agent" })).toBeInTheDocument();

      expect(rows[1]).toHaveTextContent("Read & write");
      expect(rows[1]).not.toHaveTextContent("Read only");
      expect(rows[1]).toHaveTextContent("Last used Oct 5, 2026");
      expect(rows[1]).toHaveTextContent("Never expires");
      expect(rows[1]).toHaveTextContent("Revoked");
      expect(within(rows[1]!).queryByRole("button", { name: /Revoke/ })).not.toBeInTheDocument();
    });

    it("creates a read & write token after warning what it can do", async () => {
      const { api, user } = setup();
      const region = await section();
      const access = within(region).getByRole("radiogroup", { name: "Access" });
      expect(within(access).getByRole("radio", { name: "Read only" })).toBeChecked();
      expect(region).not.toHaveTextContent("can create and edit tasks");

      await user.click(within(access).getByRole("radio", { name: "Read & write" }));
      expect(region).toHaveTextContent(
        "This token can create and edit tasks and their dependencies as you, with your access. Give it only to tools you trust.",
      );
      await user.type(within(region).getByRole("textbox", { name: "Token name" }), "Agent");
      await user.click(within(region).getByRole("button", { name: "Create token" }));

      await waitFor(() =>
        expect(api.calls).toContainEqual({
          route: "POST /api/admin/projects/app/tokens",
          body: { name: "Agent", expiresInDays: 90, scope: "write" },
        }),
      );
    });

    it("explains an empty list", async () => {
      setup({ "GET /api/admin/projects/app/tokens": [] });
      expect(await within(await section()).findByText("No tokens yet.")).toBeInTheDocument();
    });

    it("creates a token and shows its secret once, with a copy button and a usage hint", async () => {
      const { api, user, queryClient } = setup();
      const region = await section();
      const expiry = within(region).getByRole("combobox", { name: "Expires" });
      expect(expiry).toHaveValue("90");
      expect([...expiry.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
        "In 30 days",
        "In 90 days",
        "In 365 days",
        "Never",
      ]);

      await user.type(within(region).getByRole("textbox", { name: "Token name" }), "CI bot");
      await user.click(within(region).getByRole("button", { name: "Create token" }));

      await waitFor(() =>
        expect(api.calls).toContainEqual({
          route: "POST /api/admin/projects/app/tokens",
          body: { name: "CI bot", expiresInDays: 90, scope: "read" },
        }),
      );
      const dialog = await screen.findByRole("dialog", { name: "Token for CI bot created" });
      expect(within(dialog).getByText(SECRET)).toBeInTheDocument();
      expect(dialog).toHaveTextContent("Copy it now — you won’t be able to see it again");
      const hint = within(dialog).getByText(/^curl /);
      expect(hint).toHaveTextContent(
        `curl -H "Authorization: Bearer $TRACKER_API_TOKEN" ${window.location.origin}/api/projects/app/tasks`,
      );
      expect(hint.textContent).not.toContain(SECRET);

      await user.click(within(dialog).getByRole("button", { name: "Copy token" }));
      expect(await navigator.clipboard.readText()).toBe(SECRET);
      expect(await within(dialog).findByText("Copied")).toBeInTheDocument();

      await user.click(within(dialog).getByRole("button", { name: "Done" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(document.body).not.toHaveTextContent(SECRET);
      expect(await within(region).findByText("CI bot")).toBeInTheDocument();
      expect(within(region).getByRole("textbox", { name: "Token name" })).toHaveValue("");

      const cached = JSON.stringify([
        queryClient.getQueryCache().getAll().map((q) => q.state.data),
        queryClient.getMutationCache().getAll().map((m) => m.state.data),
      ]);
      expect(cached).not.toContain(SECRET);
    });

    it("creates a token that never expires", async () => {
      const { api, user } = setup();
      const region = await section();
      await user.type(within(region).getByRole("textbox", { name: "Token name" }), "Forever");
      await user.selectOptions(within(region).getByRole("combobox", { name: "Expires" }), "Never");
      await user.click(within(region).getByRole("button", { name: "Create token" }));
      await waitFor(() =>
        expect(api.calls).toContainEqual({
          route: "POST /api/admin/projects/app/tokens",
          body: { name: "Forever", expiresInDays: null, scope: "read" },
        }),
      );
    });

    it("asks for a name before calling the server", async () => {
      const { api, user } = setup();
      const region = await section();
      await user.click(within(region).getByRole("button", { name: "Create token" }));
      expect(within(region).getByRole("alert")).toHaveTextContent("Give the token a name of up to 60 characters.");
      expect(api.calls.map((c) => c.route)).not.toContain("POST /api/admin/projects/app/tokens");
    });

    it("shows the server's reason when creating fails", async () => {
      const { user } = setup({
        "POST /api/admin/projects/app/tokens": reply(400, { error: "invalid_token_expiry" }),
      });
      const region = await section();
      await user.type(within(region).getByRole("textbox", { name: "Token name" }), "CI bot");
      await user.click(within(region).getByRole("button", { name: "Create token" }));
      expect(await within(region).findByRole("alert")).toHaveTextContent("Pick one of the listed expiry options.");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("asks before revoking a token, then revokes it", async () => {
      const { api, user } = setup();
      const region = await section();
      await user.click(await within(region).findByRole("button", { name: "Revoke VPS agent" }));

      const dialog = screen.getByRole("alertdialog", { name: "Revoke VPS agent?" });
      expect(dialog).toHaveAccessibleDescription("Anything using it stops working immediately.");
      await user.click(within(dialog).getByRole("button", { name: "Revoke" }));

      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(api.calls.map((c) => c.route)).toContain("DELETE /api/admin/projects/app/tokens/1");
      await waitFor(() => expect(within(region).queryByRole("button", { name: "Revoke VPS agent" })).not.toBeInTheDocument());
    });
  });
});
