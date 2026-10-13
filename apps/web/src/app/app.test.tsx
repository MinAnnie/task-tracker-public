import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { admin, boardTask, me, projects } from "../test/fixtures.ts";
import { fakeApi, renderRoutes, reply } from "../test/render.tsx";
import { AppRoutes } from "./AppRoutes.tsx";

const location = () => screen.getByTestId("location").textContent;

function setup(route: string, overrides: Record<string, unknown> = {}) {
  const api = fakeApi({
    "GET /auth/me": me,
    "GET /api/projects": projects,
    "GET /api/projects/app/tasks": [boardTask({ key: "RF-1", title: "First task" })],
    "GET /api/projects/landing/tasks": [boardTask({ key: "LD-1", title: "Landing task" })],
    "POST /auth/logout": reply(204),
    ...overrides,
  });
  return { api, ...renderRoutes(<AppRoutes />, route), user: userEvent.setup() };
}

describe("App routes", () => {
  it("sends unauthenticated visitors to the login screen", async () => {
    setup("/projects/app", { "GET /auth/me": reply(401, { error: "unauthenticated" }) });
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(location()).toBe("/login");
  });

  it("sends the user to login when their session ends mid-use", async () => {
    let signedIn = true;
    setup("/projects/app", {
      "GET /auth/me": () => (signedIn ? me : reply(401, { error: "unauthenticated" })),
      "GET /api/projects/landing/tasks": () => reply(401, { error: "unauthenticated" }),
    });
    const user = userEvent.setup();
    await screen.findByText("First task");
    signedIn = false;
    await user.selectOptions(screen.getByRole("combobox", { name: "Project" }), "Acme Landing");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("opens the last project used in this browser", async () => {
    window.localStorage.setItem("task-tracker:last-project", "landing");
    setup("/");
    expect(await screen.findByText("Landing task")).toBeInTheDocument();
    expect(location()).toBe("/projects/landing");
  });

  it("falls back to the first project when the remembered one is gone", async () => {
    window.localStorage.setItem("task-tracker:last-project", "deleted");
    setup("/");
    expect(await screen.findByText("First task")).toBeInTheDocument();
    expect(location()).toBe("/projects/app");
  });

  it("explains when the user has no projects", async () => {
    setup("/", { "GET /api/projects": [] });
    expect(await screen.findByText(/You’re not part of any project yet/)).toBeInTheDocument();
  });

  it("shows admins with no projects a way to create the first one", async () => {
    setup("/", { "GET /auth/me": admin, "GET /api/projects": [] });
    expect(await screen.findByRole("heading", { name: "No projects yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create a project" })).toHaveAttribute("href", "/admin/projects");
    expect(screen.queryByText(/Ask an admin/)).not.toBeInTheDocument();
  });

  it("explains a project the user can't open, with a way back, and selects no project in the header", async () => {
    setup("/projects/secret", { "GET /api/projects/secret/tasks": reply(403, { error: "forbidden" }) });
    expect(await screen.findByRole("heading", { name: "You don’t have access to this project" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to your projects" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("combobox", { name: "Project" })).toHaveValue("");
  });

  it("explains a project that doesn't exist the same way", async () => {
    setup("/projects/gone", { "GET /api/projects/gone/tasks": reply(404, { error: "project_not_found" }) });
    expect(await screen.findByRole("heading", { name: "Project not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to your projects" })).toHaveAttribute("href", "/");
  });

  it("explains a task in a project the user can't open", async () => {
    setup("/projects/secret/tasks/SC-1", { "GET /api/projects/secret/tasks/SC-1": reply(403, { error: "forbidden" }) });
    expect(await screen.findByRole("heading", { name: "You don’t have access to this project" })).toBeInTheDocument();
  });

  it("switches projects from the header", async () => {
    const { user } = setup("/projects/app");
    const switcher = await screen.findByRole("combobox", { name: "Project" });
    await waitFor(() => expect(switcher).toHaveValue("app"));
    await user.selectOptions(switcher, "Acme Landing");
    expect(await screen.findByText("Landing task")).toBeInTheDocument();
    expect(location()).toBe("/projects/landing");
  });

  it("shows the Admin link only to admins", async () => {
    setup("/projects/app");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("links admins to the admin area", async () => {
    const { user } = setup("/projects/app", {
      "GET /auth/me": admin,
      "GET /api/admin/members": { admins: ["boss"], members: [] },
    });
    const nav = await screen.findByRole("navigation", { name: "Main" });
    await user.click(await within(nav).findByRole("link", { name: "Admin" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Members" })).toBeInTheDocument();
  });

  it("keeps members out of the admin area", async () => {
    setup("/admin");
    await waitFor(() => expect(location()).not.toBe("/admin"));
  });

  it("signs out from the account menu", async () => {
    const { api, user } = setup("/projects/app");
    const account = await screen.findByRole("button", { name: "Account menu for annamiller" });
    expect(account).toHaveAttribute("aria-expanded", "false");
    await user.click(account);
    expect(account).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(api.calls.map((c) => c.route)).toContain("POST /auth/logout"));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("toggles the navigation menu on phones", async () => {
    const { user } = setup("/projects/app");
    const toggle = await screen.findByRole("button", { name: "Open menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("opens a task detail from the board", async () => {
    const { user } = setup("/projects/app", {
      "GET /api/projects/app/tasks/RF-1": {
        ...boardTask({ key: "RF-1", title: "First task" }),
        description: null,
        dependsOn: [],
        blocks: [],
        pullRequests: [],
      },
    });
    await user.click(await screen.findByRole("link", { name: "First task" }));
    expect(await screen.findByRole("heading", { level: 1, name: "First task" })).toBeInTheDocument();
    expect(location()).toBe("/projects/app/tasks/RF-1");
  });
});
