import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link } from "react-router";
import { describe, expect, it } from "vitest";
import { boardTask, me, projects } from "../../test/fixtures.ts";
import { fakeApi, renderWithProviders, reply } from "../../test/render.tsx";
import { BoardContainer } from "./BoardContainer.tsx";

const mine = { login: "annamiller", name: "Anna Miller", avatarUrl: null };
const juan = { login: "juanperez", name: null, avatarUrl: null };

const tasks = [
  boardTask({ key: "RF-12", title: "Export tasks to CSV", priority: "low", stage: "Sprint 3" }),
  boardTask({ key: "RF-13", title: "Discord notification on merge", priority: "high", assignee: juan, canTake: false }),
  boardTask({
    key: "RF-14",
    title: "Discord bot: post merged PRs",
    priority: "high",
    dependsOn: ["RF-13"],
    pendingDependencies: ["RF-13"],
    canTake: false,
  }),
  boardTask({ key: "RF-9", title: "Project switcher", status: "in_progress", assignee: mine, canTake: false }),
  boardTask({
    key: "RF-4",
    title: "GitHub OAuth login",
    status: "in_review",
    priority: "urgent",
    assignee: mine,
    canTake: false,
    pullRequests: [{ number: 18, state: "open", url: "https://github.com/acme/app/pull/18" }],
  }),
];

function setup(overrides: Record<string, unknown> = {}, route = "/projects/app") {
  const api = fakeApi({
    "GET /auth/me": me,
    "GET /api/projects": projects,
    "GET /api/projects/app/tasks": tasks,
    ...overrides,
  });
  const view = renderWithProviders(<BoardContainer />, { route, path: "/projects/:slug" });
  return { api, ...view, user: userEvent.setup() };
}

const location = () => screen.getByTestId("location").textContent;
const filterToolbar = () => screen.getByRole("search", { name: "Filter tasks" });
const column = (name: string) => screen.getByRole("region", { name });
const cardKeys = (name: string) =>
  within(column(name))
    .queryAllByTestId("task-key")
    .map((el) => el.textContent);

describe("Board", () => {
  it("shows the project name and one column per status, cards sorted by priority then key", async () => {
    setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Acme App" })).toBeInTheDocument();
    await screen.findByText("Export tasks to CSV");

    expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual([
      "To do",
      "In progress",
      "In review",
      "Done",
      "Blocked",
    ]);
    expect(cardKeys("To do")).toEqual(["RF-13", "RF-14", "RF-12"]);
    expect(within(column("To do")).getByText("3")).toBeInTheDocument();
    expect(cardKeys("Done")).toEqual([]);
  });

  it("shows priority as text, the stage, the PR badge and the assignee", async () => {
    setup();
    const card = (await screen.findByText("GitHub OAuth login")).closest("article")!;
    expect(within(card).getByText("Urgent")).toBeInTheDocument();
    expect(within(card).getByText("#18")).toBeInTheDocument();
    expect(within(card).getByText("Assigned to @annamiller")).toBeInTheDocument();
    const csv = screen.getByText("Export tasks to CSV").closest("article")!;
    expect(within(csv).getByText("Low")).toBeInTheDocument();
    expect(within(csv).getByText(/Sprint 3/)).toBeInTheDocument();
  });

  it("links each card title to the task detail", async () => {
    setup();
    expect(await screen.findByRole("link", { name: "Export tasks to CSV" })).toHaveAttribute(
      "href",
      "/projects/app/tasks/RF-12",
    );
  });

  it("marks tasks waiting on dependencies and only offers Take when the task can be taken", async () => {
    setup();
    const waiting = (await screen.findByText("Discord bot: post merged PRs")).closest("article")!;
    expect(within(waiting).getByText("Waiting on RF-13")).toBeInTheDocument();
    expect(within(waiting).queryByRole("button", { name: /take/i })).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Take RF-12" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Take RF-13" })).not.toBeInTheDocument();
  });

  it("takes a task and refreshes the board", async () => {
    const { api, user } = setup({ "POST /api/projects/app/tasks/RF-12/take": {} });
    await user.click(await screen.findByRole("button", { name: "Take RF-12" }));
    await waitFor(() =>
      expect(api.calls.map((c) => c.route)).toEqual(
        expect.arrayContaining(["POST /api/projects/app/tasks/RF-12/take"]),
      ),
    );
    await waitFor(() =>
      expect(api.calls.filter((c) => c.route === "GET /api/projects/app/tasks")).toHaveLength(2),
    );
  });

  it("explains a failed take", async () => {
    const { user } = setup({
      "POST /api/projects/app/tasks/RF-12/take": reply(409, { error: "task_taken" }),
    });
    await user.click(await screen.findByRole("button", { name: "Take RF-12" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone else took this task first.");
  });

  it("searches by key or title, keeping the search in the URL", async () => {
    const { user } = setup();
    await screen.findByText("Export tasks to CSV");
    await user.type(screen.getByRole("searchbox", { name: "Search tasks" }), "rf-12");
    expect(cardKeys("To do")).toEqual(["RF-12"]);
    expect(cardKeys("In review")).toEqual([]);
    expect(location()).toBe("/projects/app?q=rf-12");
  });

  it("restores the search and filters from the URL", async () => {
    setup({}, "/projects/app?q=discord&priority=high&availability=blocked");
    await screen.findByText("Discord bot: post merged PRs");
    expect(screen.getByRole("searchbox", { name: "Search tasks" })).toHaveValue("discord");
    const toolbar = filterToolbar();
    expect(within(toolbar).getByRole("radio", { name: "Blocked by dependencies" })).toBeChecked();
    expect(within(toolbar).getByRole("checkbox", { name: "High" })).toBeChecked();
    expect(within(toolbar).getByRole("checkbox", { name: "Low" })).not.toBeChecked();
    expect(cardKeys("To do")).toEqual(["RF-14"]);
    expect(screen.getByText("Showing 1 of 5 tasks")).toBeInTheDocument();
  });

  it("filters by assignee: mine (the caller's tasks) or unassigned", async () => {
    const { user } = setup();
    await screen.findByText("Export tasks to CSV");
    const assignee = within(filterToolbar()).getByRole("radiogroup", { name: "Assignee" });
    expect(within(assignee).getByRole("radio", { name: "All" })).toBeChecked();

    await user.click(within(assignee).getByRole("radio", { name: "Mine" }));
    expect(cardKeys("To do")).toEqual([]);
    expect(cardKeys("In progress")).toEqual(["RF-9"]);
    expect(cardKeys("In review")).toEqual(["RF-4"]);
    expect(location()).toBe("/projects/app?assignee=mine");

    await user.click(within(assignee).getByRole("radio", { name: "Unassigned" }));
    expect(cardKeys("To do")).toEqual(["RF-14", "RF-12"]);
    expect(cardKeys("In review")).toEqual([]);
  });

  it("filters by availability: ready to take, or blocked by dependencies", async () => {
    const { user } = setup();
    await screen.findByText("Export tasks to CSV");
    const availability = within(filterToolbar()).getByRole("radiogroup", { name: "Availability" });

    await user.click(within(availability).getByRole("radio", { name: "Ready to take" }));
    expect(cardKeys("To do")).toEqual(["RF-12"]);
    expect(location()).toBe("/projects/app?availability=ready");

    await user.click(within(availability).getByRole("radio", { name: "Blocked by dependencies" }));
    expect(cardKeys("To do")).toEqual(["RF-14"]);

    await user.click(within(availability).getByRole("radio", { name: "Any" }));
    expect(cardKeys("To do")).toEqual(["RF-13", "RF-14", "RF-12"]);
    expect(location()).toBe("/projects/app");
  });

  it("sorts every column by priority, creation date or last update, keeping the sort in the URL", async () => {
    const dated = [
      boardTask({
        key: "RF-1",
        priority: "urgent",
        createdAt: "2026-10-01T10:00:00.000Z",
        updatedAt: "2026-10-02T10:00:00.000Z",
      }),
      boardTask({
        key: "RF-2",
        priority: "low",
        createdAt: "2026-10-05T10:00:00.000Z",
        updatedAt: "2026-10-05T10:00:00.000Z",
      }),
      boardTask({
        key: "RF-3",
        priority: "high",
        createdAt: "2026-10-03T10:00:00.000Z",
        updatedAt: "2026-10-09T10:00:00.000Z",
      }),
      boardTask({ key: "RF-4", status: "done", createdAt: "2026-10-04T10:00:00.000Z" }),
      boardTask({ key: "RF-5", status: "done", createdAt: "2026-10-02T10:00:00.000Z" }),
    ];
    const { user } = setup({ "GET /api/projects/app/tasks": dated });
    await screen.findByText("Showing 5 of 5 tasks");
    const sort = within(filterToolbar()).getByRole("combobox", { name: "Sort" });
    expect(sort).toHaveValue("priority");
    expect(within(sort).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Priority",
      "Newest first",
      "Oldest first",
      "Recently updated",
    ]);
    expect(cardKeys("To do")).toEqual(["RF-1", "RF-3", "RF-2"]);

    await user.selectOptions(sort, "Newest first");
    expect(cardKeys("To do")).toEqual(["RF-2", "RF-3", "RF-1"]);
    expect(cardKeys("Done")).toEqual(["RF-4", "RF-5"]);
    expect(location()).toBe("/projects/app?sort=newest");

    await user.selectOptions(sort, "Oldest first");
    expect(cardKeys("To do")).toEqual(["RF-1", "RF-3", "RF-2"]);
    expect(cardKeys("Done")).toEqual(["RF-5", "RF-4"]);

    await user.selectOptions(sort, "Recently updated");
    expect(cardKeys("To do")).toEqual(["RF-3", "RF-2", "RF-1"]);
    expect(location()).toBe("/projects/app?sort=updated");

    await user.selectOptions(sort, "Priority");
    expect(location()).toBe("/projects/app");
  });

  it("does not count the sort as a filter and keeps it when clearing filters", async () => {
    const { user } = setup({}, "/projects/app?sort=oldest");
    await screen.findByText("Showing 5 of 5 tasks");
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();

    await user.click(within(filterToolbar()).getByRole("checkbox", { name: "Low" }));
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(location()).toBe("/projects/app?sort=oldest");
    expect(within(filterToolbar()).getByRole("combobox", { name: "Sort" })).toHaveValue("oldest");
  });

  it("falls back to the priority sort for an unknown sort", async () => {
    setup({}, "/projects/app?sort=random");
    await screen.findByText("Showing 5 of 5 tasks");
    expect(within(filterToolbar()).getByRole("combobox", { name: "Sort" })).toHaveValue("priority");
    expect(cardKeys("To do")).toEqual(["RF-13", "RF-14", "RF-12"]);
  });

  it("filters by several priorities and stages, offering the stages present plus 'No stage'", async () => {
    const { user } = setup();
    await screen.findByText("Export tasks to CSV");
    const toolbar = filterToolbar();
    const stages = within(toolbar).getByRole("group", { name: "Stage" });
    expect(within(stages).getAllByRole("checkbox").map((c) => c.closest("label")?.textContent)).toEqual([
      "Sprint 3",
      "No stage",
    ]);

    await user.click(within(toolbar).getByRole("checkbox", { name: "High" }));
    await user.click(within(toolbar).getByRole("checkbox", { name: "Urgent" }));
    expect(cardKeys("To do")).toEqual(["RF-13", "RF-14"]);
    expect(cardKeys("In review")).toEqual(["RF-4"]);
    expect(location()).toBe("/projects/app?priority=urgent&priority=high");

    await user.click(within(stages).getByRole("checkbox", { name: "No stage" }));
    expect(cardKeys("To do")).toEqual(["RF-13", "RF-14"]);
    await user.click(within(stages).getByRole("checkbox", { name: "Sprint 3" }));
    await user.click(within(stages).getByRole("checkbox", { name: "No stage" }));
    expect(screen.getByText("Showing 0 of 5 tasks")).toBeInTheDocument();
  });

  it("counts the shown tasks politely and offers Clear filters only while something is filtered", async () => {
    const { user } = setup();
    await screen.findByText("Export tasks to CSV");
    const count = screen.getByText("Showing 5 of 5 tasks");
    expect(count).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();

    await user.click(within(filterToolbar()).getByRole("checkbox", { name: "Low" }));
    await user.type(screen.getByRole("searchbox", { name: "Search tasks" }), "csv");
    expect(screen.getByText("Showing 1 of 5 tasks")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(location()).toBe("/projects/app");
    expect(screen.getByRole("searchbox", { name: "Search tasks" })).toHaveValue("");
    expect(within(filterToolbar()).getByRole("checkbox", { name: "Low" })).not.toBeChecked();
    expect(screen.getByText("Showing 5 of 5 tasks")).toBeInTheDocument();
  });

  it("says when the filters match nothing, with a way to clear them", async () => {
    const { user } = setup({}, "/projects/app?q=nothing-like-this");
    const heading = await screen.findByRole("heading", { name: "No tasks match these filters" });
    expect(screen.queryByRole("region", { name: "To do" })).not.toBeInTheDocument();

    await user.click(within(heading.closest("section")!).getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("Export tasks to CSV")).toBeInTheDocument();
    expect(location()).toBe("/projects/app");
  });

  it("follows URL changes made elsewhere, like back and forward", async () => {
    const user = userEvent.setup();
    fakeApi({ "GET /auth/me": me, "GET /api/projects": projects, "GET /api/projects/app/tasks": tasks });
    renderWithProviders(
      <>
        <BoardContainer />
        <Link to="/projects/app?priority=low&q=csv">Elsewhere</Link>
      </>,
      { route: "/projects/app?assignee=mine", path: "/projects/:slug" },
    );
    await screen.findByText("Project switcher");
    await user.click(screen.getByRole("link", { name: "Elsewhere" }));

    expect(await screen.findByText("Showing 1 of 5 tasks")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search tasks" })).toHaveValue("csv");
    expect(within(filterToolbar()).getByRole("checkbox", { name: "Low" })).toBeChecked();
    expect(within(filterToolbar()).getByRole("radio", { name: "All" })).toBeChecked();
  });

  it("applies the filters to the phone tabs and their counts", async () => {
    setup({}, "/projects/app?assignee=mine");
    await screen.findByText("Project switcher");
    const tabs = screen.getByRole("tablist", { name: "Task status" });
    expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "To do · 0",
      "In progress · 1",
      "In review · 1",
      "Done · 0",
      "Blocked · 0",
    ]);
  });

  describe("filters sheet (phones)", () => {
    it("names how many filters are on and opens a dialog with the same filters", async () => {
      const { user } = setup({}, "/projects/app?assignee=mine&priority=high");
      await screen.findByText("Showing 0 of 5 tasks");
      const open = screen.getByRole("button", { name: "Filters (2)" });
      expect(open).toHaveAttribute("aria-haspopup", "dialog");

      await user.click(open);
      const dialog = screen.getByRole("dialog", { name: "Filters" });
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      expect(within(dialog).getByRole("radio", { name: "Mine" })).toBeChecked();
      expect(within(dialog).getByRole("checkbox", { name: "High" })).toBeChecked();
      expect(within(dialog).getByRole("group", { name: "Stage" })).toBeInTheDocument();
      expect(within(dialog).getByRole("combobox", { name: "Sort" })).toHaveValue("priority");

      await user.click(within(dialog).getByRole("checkbox", { name: "Urgent" }));
      expect(location()).toBe("/projects/app?priority=urgent&priority=high&assignee=mine");
      await user.click(within(dialog).getByRole("button", { name: "Show 1 task" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(open).toHaveFocus();
    });

    it("sorts from the sheet", async () => {
      const { user } = setup();
      await screen.findByText("Export tasks to CSV");
      await user.click(screen.getByRole("button", { name: "Filters" }));
      const dialog = screen.getByRole("dialog", { name: "Filters" });

      await user.selectOptions(within(dialog).getByRole("combobox", { name: "Sort" }), "Recently updated");
      expect(location()).toBe("/projects/app?sort=updated");
      expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    });

    it("clears every filter from the sheet and closes on Escape", async () => {
      const { user } = setup({}, "/projects/app?availability=ready");
      await screen.findByText("Export tasks to CSV");
      await user.click(screen.getByRole("button", { name: "Filters (1)" }));
      const dialog = screen.getByRole("dialog", { name: "Filters" });

      await user.click(within(dialog).getByRole("button", { name: "Clear filters" }));
      expect(location()).toBe("/projects/app");
      expect(within(dialog).getByRole("radio", { name: "Any" })).toBeChecked();
      expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();

      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("offers phone tabs, one per status with its count, selecting which column shows", async () => {
    const { user } = setup();
    await screen.findByText("Export tasks to CSV");
    const tabs = screen.getByRole("tablist", { name: "Task status" });
    const review = within(tabs).getByRole("tab", { name: "In review · 1" });
    expect(within(tabs).getByRole("tab", { name: "To do · 3" })).toHaveAttribute("aria-selected", "true");

    await user.click(review);

    expect(review).toHaveAttribute("aria-selected", "true");
    expect(column("In review")).toHaveAttribute("data-phone-visible", "true");
    expect(column("To do")).toHaveAttribute("data-phone-visible", "false");
  });

  it("links to the new task dialog", async () => {
    setup();
    expect(await screen.findByRole("link", { name: "New task" })).toHaveAttribute("href", "/projects/app/tasks/new");
  });

  it("keeps the board's filters in the new task link, so closing the dialog keeps them", async () => {
    setup({}, "/projects/app?assignee=mine");
    expect(await screen.findByRole("link", { name: "New task" })).toHaveAttribute(
      "href",
      "/projects/app/tasks/new?assignee=mine",
    );
  });

  it("remembers the project as the last one opened in this browser", async () => {
    setup();
    await screen.findByText("Export tasks to CSV");
    expect(window.localStorage.getItem("task-tracker:last-project")).toBe("app");
  });

  it("explains when the project cannot be opened", async () => {
    setup({ "GET /api/projects/app/tasks": reply(403, { error: "forbidden" }) });
    expect(await screen.findByRole("heading", { name: "You don’t have access to this project" })).toBeInTheDocument();
    expect(screen.getByText(/Ask an admin to add you/)).toBeInTheDocument();
  });

  it("shows other loading failures as an error", async () => {
    setup({ "GET /api/projects/app/tasks": reply(400, { error: "invalid_body" }) });
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Reload the page and try again.");
  });
});
