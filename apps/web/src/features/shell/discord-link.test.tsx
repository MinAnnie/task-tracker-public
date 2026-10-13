import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { CurrentUser } from "../../api/types.ts";
import { AppRoutes } from "../../app/AppRoutes.tsx";
import { boardTask, me, projects } from "../../test/fixtures.ts";
import { fakeApi, renderRoutes, reply } from "../../test/render.tsx";

const location = () => screen.getByTestId("location").textContent;

const enabled: CurrentUser = { ...me, discordLinkingEnabled: true };
const linked: CurrentUser = { ...enabled, discord: { id: "80351110224678912", username: "Nelly" } };

function setup(route: string, user: CurrentUser | (() => CurrentUser), overrides: Record<string, unknown> = {}) {
  const api = fakeApi({
    "GET /auth/me": user,
    "GET /api/projects": projects,
    "GET /api/projects/app/tasks": [boardTask({ key: "RF-1", title: "First task" })],
    ...overrides,
  });
  return { api, ...renderRoutes(<AppRoutes />, route), user: userEvent.setup() };
}

async function openAccountMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Account menu for annamiller" }));
}

describe("Discord account linking", () => {
  describe("account menu", () => {
    it("hides Discord entirely when linking is disabled", async () => {
      const { user } = setup("/projects/app", me);
      await openAccountMenu(user);
      expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
      expect(screen.queryByText(/Discord/)).not.toBeInTheDocument();
    });

    it("offers a full-page link to connect Discord when not linked", async () => {
      const { user } = setup("/projects/app", enabled);
      await openAccountMenu(user);
      const connect = screen.getByRole("link", { name: "Connect Discord" });
      expect(connect).toHaveAttribute("href", "/auth/discord");
      expect(screen.queryByRole("button", { name: "Disconnect Discord" })).not.toBeInTheDocument();
    });

    it("shows the linked account and disconnects it, refreshing the user", async () => {
      let current = linked;
      const { api, user } = setup("/projects/app", () => current, {
        "DELETE /auth/discord": () => {
          current = enabled;
          return reply(204);
        },
      });
      await openAccountMenu(user);
      expect(screen.getByText("Discord: Nelly")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Connect Discord" })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Disconnect Discord" }));

      await waitFor(() => expect(api.calls.map((c) => c.route)).toContain("DELETE /auth/discord"));
      expect(await screen.findByRole("link", { name: "Connect Discord" })).toBeInTheDocument();
      expect(screen.queryByText("Discord: Nelly")).not.toBeInTheDocument();
      expect(api.calls.filter((c) => c.route === "GET /auth/me").length).toBeGreaterThan(1);
    });

    it("reports a failed disconnect", async () => {
      const { user } = setup("/projects/app", linked, {
        "DELETE /auth/discord": reply(500, { error: "internal_error" }),
      });
      await openAccountMenu(user);
      await user.click(screen.getByRole("button", { name: "Disconnect Discord" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't disconnect Discord. Try again.");
    });
  });

  describe("result of the Discord redirect", () => {
    it("announces a linked account with its name and removes the flag from the URL", async () => {
      setup("/?discord=linked", linked);
      expect(await screen.findByText("Discord connected as Nelly.")).toHaveAttribute("role", "status");
      await screen.findByText("First task");
      expect(location()).not.toContain("discord=");
      expect(screen.getByText("Discord connected as Nelly.")).toBeInTheDocument();
    });

    it("announces a cancelled connection politely", async () => {
      setup("/?discord=cancelled", enabled);
      expect(await screen.findByText("Discord connection cancelled.")).toHaveAttribute("role", "status");
    });

    it.each([
      ["already_linked", "That Discord account is already connected to another user."],
      ["failed", "Couldn't connect Discord. Try again."],
    ])("announces %s as an error", async (flag, message) => {
      setup(`/?discord=${flag}`, enabled);
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      await waitFor(() => expect(location()).not.toContain("discord="));
    });

    it("keeps other query parameters when removing the flag", async () => {
      setup("/projects/app?discord=cancelled&view=list", enabled);
      await screen.findByText("Discord connection cancelled.");
      await waitFor(() => expect(location()).toBe("/projects/app?view=list"));
    });

    it("ignores unknown flags", async () => {
      setup("/projects/app?discord=bogus", enabled);
      await screen.findByText("First task");
      expect(screen.queryByText(/Discord/)).not.toBeInTheDocument();
    });

    it("lets the user dismiss the message", async () => {
      const { user } = setup("/projects/app?discord=cancelled", enabled);
      await screen.findByText("Discord connection cancelled.");
      await user.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByText("Discord connection cancelled.")).not.toBeInTheDocument();
    });
  });
});
