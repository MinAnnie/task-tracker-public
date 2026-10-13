import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TaskDetail } from "../../api/types.ts";
import { admin, boardTask, me, projects, taskDetail } from "../../test/fixtures.ts";
import { Route, Routes } from "react-router";
import { fakeApi, renderRoutes, renderWithProviders, reply } from "../../test/render.tsx";
import { BoardContainer } from "../board/BoardContainer.tsx";
import { TaskDetailContainer } from "./TaskDetailContainer.tsx";

const TASK = "/api/projects/app/tasks/RF-14";
const juan = { login: "juanperez", name: null, avatarUrl: null };
const mine = { login: "annamiller", name: "Anna Miller", avatarUrl: null };
const rf13 = { key: "RF-13", title: "Discord notification on merge", status: "todo" as const };

function setup(task: TaskDetail, overrides: Record<string, unknown> = {}, user = me) {
  const api = fakeApi({
    "GET /auth/me": user,
    "GET /api/projects": projects,
    "GET /api/projects/app/tasks": [boardTask({ key: "RF-13", title: rf13.title }), boardTask({ key: "RF-14" })],
    [`GET ${TASK}`]: task,
    ...overrides,
  });
  const view = renderWithProviders(<TaskDetailContainer />, {
    route: "/projects/app/tasks/RF-14",
    path: "/projects/:slug/tasks/:key",
  });
  return { api, ...view, user: userEvent.setup() };
}

const waitingTask = taskDetail({ dependsOn: [rf13], pendingDependencies: ["RF-13"], canTake: false });
const routes = (api: { calls: { route: string; body: unknown }[] }) => api.calls.map((c) => `${c.route}`);

describe("Task detail", () => {
  it("shows the task, its dependencies, what it blocks and linked pull requests", async () => {
    setup(
      taskDetail({
        dependsOn: [{ ...rf13, status: "done" }],
        blocks: [{ key: "RF-20", title: "Weekly digest", status: "todo" }],
        pullRequests: [
          {
            number: 18,
            title: "feat(server): add GitHub OAuth login",
            branch: "feat/RF-14-bot",
            url: "https://github.com/acme/app/pull/18",
            state: "open",
            author: "annamiller",
          },
        ],
      }),
    );

    expect(await screen.findByRole("heading", { level: 1, name: "Discord bot: post merged PRs" })).toBeInTheDocument();
    expect(screen.getByText("Post a message when a linked pull request is merged.")).toBeInTheDocument();
    const deps = screen.getByRole("region", { name: "Depends on" });
    expect(within(deps).getByText("Done")).toBeInTheDocument();
    expect(within(deps).getByRole("link", { name: "RF-13 Discord notification on merge" })).toHaveAttribute(
      "href",
      "/projects/app/tasks/RF-13",
    );
    const blocks = screen.getByRole("region", { name: "Blocks" });
    expect(within(blocks).getByRole("link", { name: "RF-20 Weekly digest" })).toBeInTheDocument();
    const prs = screen.getByRole("region", { name: "Linked pull requests" });
    expect(within(prs).getByRole("link", { name: "#18 feat(server): add GitHub OAuth login" })).toHaveAttribute(
      "href",
      "https://github.com/acme/app/pull/18",
    );
    expect(within(prs).getByText("Open")).toBeInTheDocument();
    expect(within(prs).getByText("feat/RF-14-bot")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Acme App board" })).toHaveAttribute("href", "/projects/app");
  });

  it("shows the empty states", async () => {
    setup(taskDetail());
    expect(await screen.findByText("No dependencies.")).toBeInTheDocument();
    expect(screen.getByText("Nothing depends on this task.")).toBeInTheDocument();
    expect(screen.getByText("None yet. Mention RF-14 in a PR title or branch to link it.")).toBeInTheDocument();
  });

  it("disables Take with a lock and an explanation while dependencies are pending", async () => {
    setup(waitingTask);
    const take = await screen.findByRole("button", { name: "Take task" });
    expect(take).toBeDisabled();
    expect(take).toHaveAccessibleDescription("Waiting on RF-13.");
    expect(screen.getByRole("status")).toHaveTextContent("Can’t be taken yet");
  });

  it("takes a free task", async () => {
    const { api, user } = setup(taskDetail(), { [`POST ${TASK}/take`]: taskDetail({ assignee: mine }) });
    await user.click(await screen.findByRole("button", { name: "Take task" }));
    await waitFor(() => expect(routes(api)).toContain(`POST ${TASK}/take`));
  });

  it("explains a failed take", async () => {
    const { user } = setup(taskDetail(), {
      [`POST ${TASK}/take`]: reply(409, { error: "dependencies_pending", pendingDependencies: ["RF-13"] }),
    });
    await user.click(await screen.findByRole("button", { name: "Take task" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Finish its dependencies first: RF-13.");
  });

  it("lets the assignee release the task and change its status", async () => {
    const { api, user } = setup(taskDetail({ assignee: mine, status: "in_progress", canTake: false }), {
      [`POST ${TASK}/release`]: taskDetail(),
      [`PATCH ${TASK}`]: taskDetail({ assignee: mine, status: "in_review" }),
    });
    expect(await screen.findByText("You (@annamiller)")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "In review");
    await waitFor(() => expect(api.calls).toContainEqual({ route: `PATCH ${TASK}`, body: { status: "in_review" } }));

    await user.click(screen.getByRole("button", { name: "Release task" }));
    await waitFor(() => expect(routes(api)).toContain(`POST ${TASK}/release`));
  });

  it("shows a status change rejected by the server", async () => {
    const { user } = setup(taskDetail({ assignee: mine, status: "in_progress", canTake: false }), {
      [`PATCH ${TASK}`]: reply(409, { error: "dependencies_pending", pendingDependencies: ["RF-13"] }),
    });
    await user.selectOptions(await screen.findByRole("combobox", { name: "Status" }), "Done");
    expect(await screen.findByRole("alert")).toHaveTextContent("Finish its dependencies first: RF-13.");
  });

  it("locks the status for someone else's task and says only an admin can reassign it", async () => {
    setup(taskDetail({ assignee: juan, status: "in_progress", canTake: false }));
    expect(await screen.findByText("@juanperez")).toBeInTheDocument();
    expect(screen.getByText("Only an admin can reassign it.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Release task" })).not.toBeInTheDocument();
  });

  it("lets an admin change the status of anyone's task and release it", async () => {
    setup(taskDetail({ assignee: juan, status: "in_progress", canTake: false }), {}, admin);
    expect(await screen.findByRole("combobox", { name: "Status" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Release task" })).toBeInTheDocument();
  });

  it("lets any participant change the priority", async () => {
    const { api, user } = setup(taskDetail({ assignee: juan, canTake: false }), {
      [`PATCH ${TASK}`]: taskDetail({ priority: "urgent" }),
    });
    await user.selectOptions(await screen.findByRole("combobox", { name: "Priority" }), "Urgent");
    await waitFor(() => expect(api.calls).toContainEqual({ route: `PATCH ${TASK}`, body: { priority: "urgent" } }));
  });

  it("adds a dependency and clears the field", async () => {
    const { api, user } = setup(taskDetail(), { [`POST ${TASK}/dependencies`]: reply(201, rf13) });
    const field = await screen.findByRole("combobox", { name: "Add a dependency" });
    await user.type(field, " rf-13 ");
    await user.click(screen.getByRole("button", { name: "Add dependency" }));

    await waitFor(() =>
      expect(api.calls).toContainEqual({ route: `POST ${TASK}/dependencies`, body: { dependsOnKey: "rf-13" } }),
    );
    await waitFor(() => expect(field).toHaveValue(""));
  });

  it("adds the task found by a title search instead of sending the title as a key", async () => {
    const { api, user } = setup(taskDetail(), { [`POST ${TASK}/dependencies`]: reply(201, rf13) });
    const field = await screen.findByRole("combobox", { name: "Add a dependency" });
    await waitFor(() => expect(routes(api)).toContain("GET /api/projects/app/tasks"));
    await user.type(field, "discord notification{Enter}");

    await waitFor(() =>
      expect(api.calls).toContainEqual({ route: `POST ${TASK}/dependencies`, body: { dependsOnKey: "RF-13" } }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("asks to pick a task when a title search matches none, without calling the server", async () => {
    const { api, user } = setup(taskDetail());
    const field = await screen.findByRole("combobox", { name: "Add a dependency" });
    await user.type(field, "wallet{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No task title contains “wallet”. Pick one from the suggestions or enter its key, like RF-7.",
    );
    expect(routes(api)).not.toContain(`POST ${TASK}/dependencies`);
  });

  it("shows why a dependency could not be added and keeps the text", async () => {
    const { user } = setup(taskDetail(), {
      [`POST ${TASK}/dependencies`]: reply(409, { error: "dependency_cycle" }),
    });
    const field = await screen.findByRole("combobox", { name: "Add a dependency" });
    await user.type(field, "RF-13{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("That would create a circular dependency.");
    expect(field).toHaveValue("RF-13");
  });

  it("asks for a key before adding an empty dependency", async () => {
    const { api, user } = setup(taskDetail());
    await user.click(await screen.findByRole("button", { name: "Add dependency" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a task key, like RF-7.");
    expect(routes(api)).not.toContain(`POST ${TASK}/dependencies`);
  });

  it("uses the project's own prefix, unpadded, in the dependency example", async () => {
    setup(taskDetail());
    expect(await screen.findByRole("combobox", { name: "Add a dependency" })).toHaveAttribute(
      "placeholder",
      "Search tasks in this project, e.g. RF-7",
    );
  });

  it("removes a dependency and shows a failure", async () => {
    const { api, user } = setup(waitingTask, {
      [`DELETE ${TASK}/dependencies/RF-13`]: reply(404, { error: "dependency_not_found" }),
    });
    await user.click(await screen.findByRole("button", { name: "Remove dependency on RF-13" }));
    await waitFor(() => expect(routes(api)).toContain(`DELETE ${TASK}/dependencies/RF-13`));
    expect(await screen.findByRole("alert")).toHaveTextContent("That dependency was already removed.");
  });

  it("moves focus to the add field after removing the last dependency", async () => {
    let removed = false;
    const { user } = setup(waitingTask, {
      [`GET ${TASK}`]: () => (removed ? taskDetail() : waitingTask),
      [`DELETE ${TASK}/dependencies/RF-13`]: () => {
        removed = true;
        return reply(204);
      },
    });
    await user.click(await screen.findByRole("button", { name: "Remove dependency on RF-13" }));

    expect(await screen.findByText("No dependencies.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Add a dependency" })).toHaveFocus());
  });

  it("moves focus to the next dependency's Remove button after removing one", async () => {
    const rf15 = { key: "RF-15", title: "Weekly digest", status: "todo" as const };
    const both = taskDetail({ dependsOn: [rf13, rf15], pendingDependencies: ["RF-13", "RF-15"], canTake: false });
    let removed = false;
    const { user } = setup(both, {
      [`GET ${TASK}`]: () =>
        removed ? taskDetail({ dependsOn: [rf15], pendingDependencies: ["RF-15"], canTake: false }) : both,
      [`DELETE ${TASK}/dependencies/RF-13`]: () => {
        removed = true;
        return reply(204);
      },
    });
    await user.click(await screen.findByRole("button", { name: "Remove dependency on RF-13" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Remove dependency on RF-15" })).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Remove dependency on RF-13" })).not.toBeInTheDocument();
  });

  describe("reassigning (admins)", () => {
    const participants = [juan, mine];

    it("is not offered to members", async () => {
      const { api } = setup(taskDetail({ assignee: juan, status: "in_progress", canTake: false }));
      expect(await screen.findByText("Only an admin can reassign it.")).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Assignee" })).not.toBeInTheDocument();
      expect(routes(api)).not.toContain("GET /api/projects/app/participants");
    });

    it("lets an admin pick another participant or nobody", async () => {
      const { api, user } = setup(
        taskDetail({ assignee: juan, status: "in_progress", canTake: false }),
        {
          "GET /api/projects/app/participants": participants,
          [`PATCH ${TASK}`]: ({ body }: { body: unknown }) => taskDetail({ ...(body as object) }),
        },
        admin,
      );
      const select = await screen.findByRole("combobox", { name: "Assignee" });
      await waitFor(() => expect(select).toHaveValue("juanperez"));
      await user.selectOptions(select, "Anna Miller (@annamiller)");
      await waitFor(() =>
        expect(api.calls).toContainEqual({ route: `PATCH ${TASK}`, body: { assigneeLogin: "annamiller" } }),
      );

      await user.selectOptions(screen.getByRole("combobox", { name: "Assignee" }), "Unassigned");
      await waitFor(() => expect(api.calls).toContainEqual({ route: `PATCH ${TASK}`, body: { assigneeLogin: null } }));
    });

    it("explains a refused assignee", async () => {
      const { user } = setup(
        taskDetail(),
        {
          "GET /api/projects/app/participants": participants,
          [`PATCH ${TASK}`]: reply(400, { error: "invalid_assignee" }),
        },
        admin,
      );
      const select = await screen.findByRole("combobox", { name: "Assignee" });
      await waitFor(() => expect(within(select).getByRole("option", { name: "@juanperez" })).toBeInTheDocument());
      await user.selectOptions(select, "@juanperez");
      expect(await screen.findByRole("alert")).toHaveTextContent("That person can’t be assigned tasks in this project.");
    });

    it("explains pending dependencies reported by the server", async () => {
      const { user } = setup(
        taskDetail(),
        {
          "GET /api/projects/app/participants": participants,
          [`PATCH ${TASK}`]: reply(409, { error: "dependencies_pending", pendingDependencies: ["RF-13"] }),
        },
        admin,
      );
      const select = await screen.findByRole("combobox", { name: "Assignee" });
      await waitFor(() => expect(within(select).getByRole("option", { name: "@juanperez" })).toBeInTheDocument());
      await user.selectOptions(select, "@juanperez");
      expect(await screen.findByRole("alert")).toHaveTextContent("Finish its dependencies first: RF-13.");
    });

    it("can't assign while dependencies are pending, saying why", async () => {
      setup(waitingTask, { "GET /api/projects/app/participants": participants }, admin);
      const select = await screen.findByRole("combobox", { name: "Assignee" });
      expect(select).toBeDisabled();
      expect(select).toHaveAccessibleDescription("Can’t be assigned until RF-13 is done.");
    });

    it("can still unassign while dependencies are pending", async () => {
      setup(
        taskDetail({ assignee: juan, dependsOn: [rf13], pendingDependencies: ["RF-13"], canTake: false }),
        { "GET /api/projects/app/participants": participants },
        admin,
      );
      const select = await screen.findByRole("combobox", { name: "Assignee" });
      expect(select).toBeEnabled();
      await waitFor(() =>
        expect(within(select).getByRole("option", { name: "Anna Miller (@annamiller)" })).toBeDisabled(),
      );
      expect(within(select).getByRole("option", { name: "Unassigned" })).toBeEnabled();
      expect(select).toHaveAccessibleDescription("Can’t be assigned until RF-13 is done.");
    });
  });

  it("explains a task that does not exist", async () => {
    setup(taskDetail(), { [`GET ${TASK}`]: reply(404, { error: "task_not_found" }) });
    expect(await screen.findByRole("alert")).toHaveTextContent("There’s no task with that key in this project.");
  });

  describe("deleting", () => {
    const pr = (number: number) => ({
      number,
      title: `PR ${number}`,
      branch: `feat/RF-14-${number}`,
      url: `https://github.com/acme/app/pull/${number}`,
      state: "open" as const,
      author: "annamiller",
    });
    const blocker = (key: string) => ({ key, title: `Task ${key}`, status: "todo" as const });

    async function openDialog(task: TaskDetail, overrides: Record<string, unknown> = {}) {
      const view = setup(task, overrides, admin);
      await view.user.click(await screen.findByRole("button", { name: "Delete task…" }));
      return { ...view, dialog: screen.getByRole("alertdialog", { name: "Delete RF-14?" }) };
    }

    it("is not offered to members", async () => {
      setup(taskDetail());
      await screen.findByRole("heading", { level: 1 });
      expect(screen.queryByRole("button", { name: /Delete task/ })).not.toBeInTheDocument();
    });

    it("asks first, focusing Cancel, and gives focus back to the trigger on cancel", async () => {
      const { api, user, dialog } = await openDialog(taskDetail());

      expect(dialog).toHaveAccessibleDescription("This can’t be undone.");
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
      expect(within(dialog).getByRole("button", { name: "Delete task" })).toBeEnabled();

      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Delete task…" })).toHaveFocus();
      expect(routes(api)).not.toContain(`DELETE ${TASK}`);
    });

    it("names the tasks that depend on it and the pull requests that get unlinked", async () => {
      const { dialog } = await openDialog(
        taskDetail({ blocks: [blocker("RF-9"), blocker("RF-12")], pullRequests: [pr(18), pr(19)] }),
      );
      expect(dialog).toHaveAccessibleDescription(
        "This can’t be undone. RF-9 and RF-12 will lose this dependency. " +
          "2 linked pull requests will be unlinked (they stay on GitHub).",
      );
    });

    it("words a single dependent and pull request, and longer lists", async () => {
      const one = await openDialog(taskDetail({ blocks: [blocker("RF-20")], pullRequests: [pr(18)] }));
      expect(one.dialog).toHaveAccessibleDescription(
        "This can’t be undone. RF-20 will lose this dependency. " +
          "1 linked pull request will be unlinked (it stays on GitHub).",
      );
      one.unmount();

      const many = await openDialog(taskDetail({ blocks: [blocker("RF-9"), blocker("RF-12"), blocker("RF-20")] }));
      expect(many.dialog).toHaveAccessibleDescription(
        "This can’t be undone. RF-9, RF-12 and RF-20 will lose this dependency.",
      );
    });

    it("deletes, returns to the board, refreshes it and announces the deletion", async () => {
      const api = fakeApi({
        "GET /auth/me": admin,
        "GET /api/projects": projects,
        "GET /api/projects/app/tasks": [boardTask({ key: "RF-13", title: rf13.title })],
        [`GET ${TASK}`]: taskDetail(),
        [`DELETE ${TASK}`]: reply(204),
      });
      renderRoutes(
        <Routes>
          <Route path="/projects/:slug" element={<BoardContainer />} />
          <Route path="/projects/:slug/tasks/:key" element={<TaskDetailContainer />} />
        </Routes>,
        "/projects/app/tasks/RF-14",
      );
      const user = userEvent.setup();

      await user.click(await screen.findByRole("button", { name: "Delete task…" }));
      await user.click(screen.getByRole("button", { name: "Delete task" }));

      await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/projects\/app$/));
      expect(await screen.findByRole("status")).toHaveTextContent("Deleted RF-14");
      const afterDelete = () => routes(api).slice(routes(api).indexOf(`DELETE ${TASK}`) + 1);
      await waitFor(() => expect(afterDelete()).toContain("GET /api/projects/app/tasks"));
      expect(afterDelete()).not.toContain(`GET ${TASK}`);
    });

    it("shows why a delete failed, keeping the dialog open", async () => {
      const { user, dialog } = await openDialog(taskDetail(), {
        [`DELETE ${TASK}`]: reply(403, { error: "forbidden" }),
      });

      await user.click(within(dialog).getByRole("button", { name: "Delete task" }));

      expect(await within(dialog).findByRole("alert")).toHaveTextContent("You don’t have permission to do that.");
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });
  });
});

describe("Copying the task", () => {
  const description = () => screen.getByRole("region", { name: "Description" });

  it("copies a prompt for an AI agent, for every participant", async () => {
    const { user } = setup(taskDetail({ description: "Line one\n\n- **bold**" }));
    const copyForAi = await within(await screen.findByRole("region", { name: "Description" })).findByRole("button", {
      name: "Copy for AI",
    });
    const write = vi.spyOn(navigator.clipboard, "writeText");

    await user.click(copyForAi);

    expect(write).toHaveBeenCalledTimes(1);
    const text = write.mock.calls[0]![0];
    expect(text).toMatch(/^# RF-14 — Discord bot: post merged PRs\n/);
    expect(text).toContain("- Project: Acme App\n");
    expect(text).toContain("- Status: To do · Priority: High · Stage: Sprint 3\n");
    expect(text).toContain("- Branch: feat/RF-14-discord-bot-post-merged-prs\n");
    expect(text).toContain(`- Link: ${window.location.origin}/projects/app/tasks/RF-14\n`);
    expect(text).toMatch(/## Description\n\nLine one\n\n- \*\*bold\*\*$/);
    expect(copyForAi).toHaveTextContent("Copied");
    expect(within(description()).getByText("Copied to clipboard")).toBeInTheDocument();
  });

  it("copies only the description", async () => {
    const { user } = setup(taskDetail({ description: "Raw *markdown* text" }));
    const copy = await screen.findByRole("button", { name: "Copy description" });
    const write = vi.spyOn(navigator.clipboard, "writeText");

    await user.click(copy);

    expect(write).toHaveBeenCalledWith("Raw *markdown* text");
    expect(copy).toHaveTextContent("Copied");
    expect(within(description()).getByRole("button", { name: "Copy for AI" })).toHaveTextContent("Copy for AI");
    expect(within(description()).getByText("Copied to clipboard")).toBeInTheDocument();
  });

  it("disables copying the description when there is none, saying why", async () => {
    setup(taskDetail({ description: null }));
    const copy = await screen.findByRole("button", { name: "Copy description" });
    expect(copy).toBeDisabled();
    expect(copy).toHaveAccessibleDescription("This task has no description to copy.");
    expect(within(description()).getByRole("button", { name: "Copy for AI" })).toBeEnabled();
  });

  it("asks to copy by hand when the clipboard refuses, selecting the description", async () => {
    const { user } = setup(taskDetail());
    const copy = await screen.findByRole("button", { name: "Copy description" });
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new DOMException("denied", "NotAllowedError"));

    await user.click(copy);

    expect(await within(description()).findByRole("alert")).toHaveTextContent(
      "Couldn't copy. Select the text manually.",
    );
    expect(copy).toHaveTextContent("Copy description");
    expect(window.getSelection()?.toString()).toBe("Post a message when a linked pull request is merged.");
  });

  it("asks to copy by hand when there is no clipboard", async () => {
    const { user } = setup(taskDetail());
    const copyForAi = await screen.findByRole("button", { name: "Copy for AI" });
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });

    await user.click(copyForAi);

    expect(await within(description()).findByRole("alert")).toHaveTextContent(
      "Couldn't copy. Select the text manually.",
    );
  });
});
