import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AppRoutes } from "../../app/AppRoutes.tsx";
import { admin, adminProjectDetail, me, projects } from "../../test/fixtures.ts";
import { fakeApi, renderRoutes } from "../../test/render.tsx";

const location = () => screen.getByTestId("location").textContent;
const endpoint = () => `${window.location.origin}/mcp`;

const CLIENTS = ["Claude Code", "Cursor", "VS Code (GitHub Copilot)", "Windsurf", "Codex CLI", "Gemini CLI"];

function setup() {
  fakeApi({ "GET /auth/me": me, "GET /api/projects": projects, "GET /api/account/tokens": [] });
  return { ...renderRoutes(<AppRoutes />, "/account/ai"), user: userEvent.setup() };
}

const snippetOf = (name: string) => {
  const region = screen.getByRole("region", { name });
  return { region, code: region.querySelector("pre")?.textContent ?? "" };
};

describe("Connect your AI page", () => {
  it("is reached from the account menu", async () => {
    fakeApi({ "GET /auth/me": me, "GET /api/projects": projects, "GET /api/projects/app/tasks": [] });
    renderRoutes(<AppRoutes />, "/projects/app");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Account menu for annamiller" }));
    await user.click(screen.getByRole("link", { name: "Connect your AI" }));

    expect(location()).toBe("/account/ai");
    expect(await screen.findByRole("heading", { level: 1, name: "Connect your AI" })).toBeInTheDocument();
  });

  it("shows this app's MCP endpoint with a copy button", async () => {
    const { user } = setup();
    const region = await screen.findByRole("region", { name: "Endpoint" });
    expect(region).toHaveTextContent(endpoint());

    await user.click(within(region).getByRole("button", { name: "Copy endpoint URL" }));

    expect(await navigator.clipboard.readText()).toBe(endpoint());
    expect(await within(region).findByText("Copied")).toBeInTheDocument();
  });

  it("explains how to get a personal token, linking to the tokens page", async () => {
    const { user } = setup();
    const region = await screen.findByRole("region", { name: "Token" });
    expect(region).toHaveTextContent("shown only once");
    expect(region).toHaveTextContent("Read & write");

    await user.click(within(region).getByRole("link", { name: "Create a personal token" }));

    expect(location()).toBe("/account/tokens");
  });

  it("gives a setup snippet per client with the endpoint and a token placeholder, never a real token", async () => {
    setup();
    await screen.findByRole("heading", { level: 1, name: "Connect your AI" });
    for (const name of CLIENTS) {
      const { code } = snippetOf(name);
      expect(code, name).toContain(endpoint());
      expect(code, name).not.toMatch(/ttk_/);
    }
    expect(snippetOf("Claude Code").code).toBe(
      `claude mcp add --transport http --scope user task-tracker ${endpoint()} --header "Authorization: Bearer <YOUR_TOKEN>"`,
    );
    expect(JSON.parse(snippetOf("Cursor").code)).toEqual({
      mcpServers: { "task-tracker": { url: endpoint(), headers: { Authorization: "Bearer <YOUR_TOKEN>" } } },
    });
    expect(JSON.parse(snippetOf("VS Code (GitHub Copilot)").code)).toMatchObject({
      servers: { "task-tracker": { type: "http", url: endpoint(), headers: { Authorization: "Bearer ${input:task-tracker-token}" } } },
      inputs: [{ type: "promptString", id: "task-tracker-token", password: true }],
    });
    expect(JSON.parse(snippetOf("Windsurf").code)).toEqual({
      mcpServers: { "task-tracker": { serverUrl: endpoint(), headers: { Authorization: "Bearer <YOUR_TOKEN>" } } },
    });
    expect(snippetOf("Codex CLI").code).toContain('bearer_token_env_var = "TASK_TRACKER_TOKEN"');
    expect(snippetOf("Gemini CLI").code).toBe(
      `gemini mcp add --transport http --header "Authorization: Bearer <YOUR_TOKEN>" task-tracker ${endpoint()}`,
    );
    const generic = screen.getByRole("region", { name: "Any MCP client" });
    expect(generic).toHaveTextContent(endpoint());
    expect(generic).toHaveTextContent("Authorization: Bearer <YOUR_TOKEN>");
    expect(generic).toHaveTextContent("Streamable HTTP");
  });

  it("copies a client's snippet", async () => {
    const { user } = setup();
    await screen.findByRole("region", { name: "Cursor" });
    const { region, code } = snippetOf("Cursor");
    await user.click(within(region).getByRole("button", { name: "Copy Cursor setup" }));
    expect(await navigator.clipboard.readText()).toBe(code);
    expect(await within(region).findByText("Copied")).toBeInTheDocument();
  });

  it("says ChatGPT is not supported yet", async () => {
    setup();
    expect(await screen.findByText(/ChatGPT/)).toHaveTextContent("not supported yet");
  });

  it("is linked from the personal API tokens page", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("link", { name: "Create a personal token" }));
    await user.click(await screen.findByRole("link", { name: "Connect your AI" }));
    expect(location()).toBe("/account/ai");
  });

  it("is linked from a project's API tokens section", async () => {
    fakeApi({
      "GET /auth/me": admin,
      "GET /api/projects": projects,
      "GET /api/admin/projects/app": adminProjectDetail(),
      "GET /api/admin/projects/app/tokens": [],
      "GET /api/admin/projects/app/stages": [],
    });
    renderRoutes(<AppRoutes />, "/admin/projects/app");
    const user = userEvent.setup();

    const tokens = await screen.findByRole("region", { name: "API tokens" });
    await user.click(within(tokens).getByRole("link", { name: "Connect your AI" }));

    expect(location()).toBe("/account/ai");
  });
});
