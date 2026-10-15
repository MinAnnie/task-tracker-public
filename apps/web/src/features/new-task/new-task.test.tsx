import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { Dialog } from "../../ui/Dialog.tsx";
import { boardTask, me, projects, taskDetail } from "../../test/fixtures.ts";
import { fakeApi, renderRoutes, reply } from "../../test/render.tsx";
import { BoardContainer } from "../board/BoardContainer.tsx";
import { nextTaskKey, validateNewTask } from "./new-task-model.ts";
import { NewTaskContainer } from "./NewTaskContainer.tsx";

describe("validateNewTask", () => {
  it("requires a title of 1 to 200 characters", () => {
    expect(validateNewTask({ title: "   " })).toEqual({ title: "Give the task a title." });
    expect(validateNewTask({ title: "x".repeat(201) })).toEqual({ title: "Keep the title under 200 characters." });
    expect(validateNewTask({ title: " Ship it " })).toEqual({});
  });
});

describe("nextTaskKey", () => {
  it("numbers past the highest key with the project's prefix", () => {
    expect(nextTaskKey("RF", ["RF-1", "RF-12", "XX-99", "RF-x"])).toBe("RF-13");
    expect(nextTaskKey("RF", [])).toBe("RF-1");
  });
});

describe("Dialog", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        {open && (
          <Dialog labelledBy="d-title" onClose={() => setOpen(false)}>
            <h1 id="d-title">Hello</h1>
            <input aria-label="First" data-autofocus />
            <button type="button">Last</button>
          </Dialog>
        )}
      </>
    );
  }

  it("is a labelled modal that focuses its first field, traps Tab, closes on Escape and returns focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Hello" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("textbox", { name: "First" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("textbox", { name: "First" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});

describe("New task", () => {
  const created = taskDetail({ key: "RF-13", title: "Ship it" });

  function setup(overrides: Record<string, unknown> = {}, route = "/projects/app/tasks/new") {
    const api = fakeApi({
      "GET /auth/me": me,
      "GET /api/projects": projects,
      "GET /api/projects/app/tasks": [boardTask({ key: "RF-12" })],
      "POST /api/projects/app/tasks": reply(201, created),
      "GET /api/projects/app/participants": [
        { login: "zoe", name: "Zoe Q", avatarUrl: null },
        { login: "AnnaMiller", name: "Anna Miller", avatarUrl: null },
        { login: "bob", name: null, avatarUrl: null },
      ],
      ...overrides,
    });
    const view = renderRoutes(
      <Routes>
        <Route path="/projects/:slug" element={<BoardContainer />}>
          <Route path="tasks/new" element={<NewTaskContainer />} />
        </Route>
      </Routes>,
      route,
    );
    return { api, ...view, user: userEvent.setup() };
  }

  const location = () => screen.getByTestId("location").textContent;

  it("opens as a modal over the board, naming the project and the key it will get", async () => {
    setup();
    const dialog = await screen.findByRole("dialog", { name: "New task" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent("Acme App · will be created as RF-13");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Title" })).toHaveFocus());
  });

  it("defaults the priority to Medium, explaining each choice", async () => {
    const { user } = setup();
    const group = await screen.findByRole("radiogroup", { name: "Priority" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Medium" })).toBeChecked();
    expect(screen.getByText("Medium: the default for planned work.")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Urgent" }));
    expect(screen.getByText("Urgent: drop what you’re doing. Shows first in every column.")).toBeInTheDocument();
  });

  it("requires a title before creating", async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole("button", { name: "Create task" }));

    const title = screen.getByRole("textbox", { name: "Title" });
    expect(screen.getByRole("alert")).toHaveTextContent("Give the task a title.");
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(title).toHaveAccessibleDescription("Give the task a title.");
    expect(title).toHaveFocus();
    expect(api.calls.map((c) => c.route)).not.toContain("POST /api/projects/app/tasks");
  });

  it("creates the task with the entered fields and returns to the board", async () => {
    const { api, user } = setup();
    await user.type(await screen.findByRole("textbox", { name: "Title" }), "  Ship it ");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.type(screen.getByRole("textbox", { name: /Description/ }), "Details");
    // The board behind the dialog has its own Assignee filter.
    const dialog = screen.getByRole("dialog", { name: "New task" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Assignee" }), "Me (@annamiller)");
    await user.type(screen.getByRole("textbox", { name: /Stage/ }), "Sprint 3");
    await user.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() =>
      expect(api.calls).toContainEqual({
        route: "POST /api/projects/app/tasks",
        body: {
          title: "Ship it",
          priority: "high",
          description: "Details",
          stage: "Sprint 3",
          assigneeLogin: "annamiller",
        },
      }),
    );
    await waitFor(() => expect(location()).toBe("/projects/app"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers Unassigned, Me, then the project's other participants", async () => {
    const { api, user } = setup();
    const dialog = await screen.findByRole("dialog", { name: "New task" });
    const select = await within(dialog).findByRole("combobox", { name: "Assignee" });
    await waitFor(() =>
      expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
        "Unassigned",
        "Me (@annamiller)",
        "Zoe Q (@zoe)",
        "@bob",
      ]),
    );

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Ship it");
    await user.selectOptions(select, "Zoe Q (@zoe)");
    await user.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() =>
      expect(api.calls).toContainEqual({
        route: "POST /api/projects/app/tasks",
        body: { title: "Ship it", priority: "medium", assigneeLogin: "zoe" },
      }),
    );
  });

  it("still offers Unassigned and Me when participants can't load", async () => {
    setup({ "GET /api/projects/app/participants": reply(403, { error: "forbidden" }) });
    const dialog = await screen.findByRole("dialog", { name: "New task" });
    const select = await within(dialog).findByRole("combobox", { name: "Assignee" });
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Unassigned",
      "Me (@annamiller)",
    ]);
  });

  it("with 'Create another', stays open with a fresh form", async () => {
    const { api, user } = setup();
    const title = await screen.findByRole("textbox", { name: "Title" });
    await user.type(title, "Ship it");
    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(screen.getByRole("checkbox", { name: "Create another" }));
    await user.click(screen.getByRole("button", { name: "Create task" }));

    expect(await screen.findByText("Created RF-13.")).toBeInTheDocument();
    expect(api.calls).toContainEqual({ route: "POST /api/projects/app/tasks", body: { title: "Ship it", priority: "low" } });
    expect(location()).toBe("/projects/app/tasks/new");
    expect(title).toHaveValue("");
    expect(title).toHaveFocus();
    expect(screen.getByRole("radio", { name: "Medium" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Create another" })).toBeChecked();
  });

  it("shows the server's reason when creation fails", async () => {
    const { user } = setup({ "POST /api/projects/app/tasks": reply(400, { error: "invalid_task_stage" }) });
    await user.type(await screen.findByRole("textbox", { name: "Title" }), "Ship it");
    await user.click(screen.getByRole("button", { name: "Create task" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The stage can be at most 50 characters.");
    expect(location()).toBe("/projects/app/tasks/new");
  });

  it("closes with Escape or Cancel and goes back to the board", async () => {
    const { user } = setup();
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(location()).toBe("/projects/app"));
  });

  it("goes back to the board with the filters it was opened from", async () => {
    const { user } = setup({}, "/projects/app/tasks/new?priority=high&q=ship");
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(location()).toBe("/projects/app?priority=high&q=ship"));
  });

  it("closes with Cancel", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(location()).toBe("/projects/app"));
  });
});
