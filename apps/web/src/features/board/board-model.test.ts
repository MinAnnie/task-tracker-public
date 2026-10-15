import { describe, expect, it } from "vitest";
import type { BoardTask } from "../../api/types.ts";
import { boardTask } from "../../test/fixtures.ts";
import {
  activeFilterCount,
  assigneeOptions,
  clearFilters,
  compareBoardTasks,
  filterTasks,
  groupByStatus,
  hasActiveFilters,
  NO_FILTERS,
  NO_STAGE,
  parseBoardFilters,
  stageOptions,
  waitingOn,
  writeBoardFilters,
  type BoardFilters,
  type BoardSort,
} from "./board-model.ts";

const keys = (tasks: readonly BoardTask[]) => tasks.map((t) => t.key);

describe("compareBoardTasks", () => {
  it("orders by priority first, then by key number (not lexicographically)", () => {
    const tasks = [
      boardTask({ key: "RF-10", priority: "low" }),
      boardTask({ key: "RF-9", priority: "medium" }),
      boardTask({ key: "RF-12", priority: "urgent" }),
      boardTask({ key: "RF-2", priority: "medium" }),
    ];
    expect(keys([...tasks].sort(compareBoardTasks))).toEqual(["RF-12", "RF-2", "RF-9", "RF-10"]);
  });
});

describe("groupByStatus", () => {
  it("returns the five status columns in board order, each sorted", () => {
    const columns = groupByStatus([
      boardTask({ key: "RF-3", status: "done" }),
      boardTask({ key: "RF-2", status: "todo", priority: "low" }),
      boardTask({ key: "RF-1", status: "todo", priority: "high" }),
      boardTask({ key: "RF-4", status: "blocked" }),
    ]);

    expect(columns.map((c) => c.status)).toEqual(["todo", "in_progress", "in_review", "done", "blocked"]);
    expect(columns.map((c) => c.label)).toEqual(["To do", "In progress", "In review", "Done", "Blocked"]);
    expect(keys(columns[0]!.tasks)).toEqual(["RF-1", "RF-2"]);
    expect(columns[1]!.tasks).toEqual([]);
    expect(keys(columns[3]!.tasks)).toEqual(["RF-3"]);
  });
});

describe("groupByStatus with a sort", () => {
  const tasks = [
    boardTask({
      key: "RF-1",
      priority: "urgent",
      createdAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-03T10:00:00.000Z",
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
    boardTask({
      key: "RF-4",
      priority: "medium",
      createdAt: "2026-10-03T10:00:00.000Z",
      updatedAt: "2026-10-03T10:00:00.000Z",
    }),
    boardTask({ key: "RF-5", status: "done", createdAt: "2026-10-09T10:00:00.000Z" }),
  ];
  const todo = (sort: BoardSort) => keys(groupByStatus(tasks, sort)[0]!.tasks);

  it("sorts by priority by default", () => {
    expect(keys(groupByStatus(tasks)[0]!.tasks)).toEqual(["RF-1", "RF-3", "RF-4", "RF-2"]);
    expect(todo("priority")).toEqual(["RF-1", "RF-3", "RF-4", "RF-2"]);
  });

  it("sorts by creation, newest or oldest first, breaking ties by priority then key", () => {
    expect(todo("newest")).toEqual(["RF-2", "RF-3", "RF-4", "RF-1"]);
    expect(todo("oldest")).toEqual(["RF-1", "RF-3", "RF-4", "RF-2"]);
  });

  it("sorts by the most recently updated first", () => {
    expect(todo("updated")).toEqual(["RF-3", "RF-2", "RF-1", "RF-4"]);
  });

  it("sorts within every column", () => {
    expect(keys(groupByStatus(tasks, "newest")[3]!.tasks)).toEqual(["RF-5"]);
  });
});

describe("filterTasks", () => {
  const anna = { login: "Anna", name: null, avatarUrl: null };
  const juan = { login: "juan", name: null, avatarUrl: null };
  const tasks = [
    boardTask({
      key: "RF-1",
      title: "GitHub OAuth login",
      assignee: anna,
      canTake: false,
      priority: "urgent",
      stage: "Etapa 1",
    }),
    boardTask({ key: "RF-12", title: "Export tasks to CSV", priority: "low", stage: "Etapa 2" }),
    boardTask({ key: "RF-13", title: "Discord notification", assignee: juan, canTake: false, priority: "high" }),
    boardTask({
      key: "AUTH-08B",
      title: "Login (part 2)",
      priority: "high",
      stage: "Etapa 1",
      pendingDependencies: ["RF-1"],
      canTake: false,
    }),
    boardTask({ key: "RF-20", title: "Done thing", status: "done", canTake: false, stage: "Etapa 2" }),
  ];
  const run = (filters: Partial<BoardFilters>, me = "anna") =>
    keys(filterTasks(tasks, { ...NO_FILTERS, ...filters }, me));

  it("keeps everything with no filter", () => {
    expect(run({})).toEqual(["RF-1", "RF-12", "RF-13", "AUTH-08B", "RF-20"]);
  });

  it("searches by key or title, case-insensitively and ignoring surrounding spaces", () => {
    expect(run({ query: " rf-12 " })).toEqual(["RF-12"]);
    expect(run({ query: "discord" })).toEqual(["RF-13"]);
    expect(run({ query: "08b" })).toEqual(["AUTH-08B"]);
  });

  it("keeps the caller's tasks for 'mine' (logins compare case-insensitively) and nobody's for 'unassigned'", () => {
    expect(run({ assignee: "mine" })).toEqual(["RF-1"]);
    expect(run({ assignee: "unassigned" })).toEqual(["RF-12", "AUTH-08B", "RF-20"]);
  });

  it("keeps the tasks of one member, comparing logins case-insensitively", () => {
    expect(run({ assignee: "juan" })).toEqual(["RF-13"]);
    expect(run({ assignee: "anna" }, "someone-else")).toEqual(["RF-1"]);
    expect(run({ assignee: "nobody-here" })).toEqual([]);
  });

  it("'ready' keeps the tasks the server says can be taken; 'blocked' those with pending dependencies", () => {
    expect(run({ availability: "ready" })).toEqual(["RF-12"]);
    expect(run({ availability: "blocked" })).toEqual(["AUTH-08B"]);
  });

  it("keeps any of the selected priorities", () => {
    expect(run({ priorities: ["urgent", "high"] })).toEqual(["RF-1", "RF-13", "AUTH-08B"]);
  });

  it("keeps any of the selected stages, where the empty stage stands for tasks without one", () => {
    expect(run({ stages: ["Etapa 2"] })).toEqual(["RF-12", "RF-20"]);
    expect(run({ stages: ["Etapa 1", NO_STAGE] })).toEqual(["RF-1", "RF-13", "AUTH-08B"]);
  });

  it("combines every filter with AND", () => {
    expect(run({ priorities: ["high"], stages: ["Etapa 1"], availability: "blocked", query: "login" })).toEqual([
      "AUTH-08B",
    ]);
    expect(run({ assignee: "mine", query: "csv" })).toEqual([]);
  });
});

describe("parseBoardFilters / writeBoardFilters", () => {
  it("reads nothing as no filters, sorted by priority", () => {
    expect(parseBoardFilters(new URLSearchParams())).toEqual(NO_FILTERS);
    expect(NO_FILTERS.sort).toBe("priority");
  });

  it.each(["priority", "newest", "oldest", "updated"] as const)("reads the %s sort", (sort) => {
    expect(parseBoardFilters(new URLSearchParams(`sort=${sort}`)).sort).toBe(sort);
  });

  it("round-trips every filter through the query string", () => {
    const filters: BoardFilters = {
      query: "login",
      availability: "ready",
      priorities: ["urgent", "low"],
      stages: ["Etapa 1 · Auth", NO_STAGE],
      assignee: "mine",
      sort: "newest",
    };
    const params = writeBoardFilters(filters);
    expect(params.toString()).toBe(
      "q=login&availability=ready&priority=urgent&priority=low&stage=Etapa+1+%C2%B7+Auth&stage=&assignee=mine&sort=newest",
    );
    expect(parseBoardFilters(params)).toEqual(filters);
  });

  it("leaves defaults out of the URL and keeps unrelated parameters", () => {
    const params = writeBoardFilters(
      { ...NO_FILTERS, query: "  ", sort: "priority" },
      new URLSearchParams("other=1&q=old&priority=low&sort=newest"),
    );
    expect(params.toString()).toBe("other=1");
  });

  it("reads a GitHub login as the assignee, lowercased, keeping the keywords", () => {
    expect(parseBoardFilters(new URLSearchParams("assignee=JuanPerez")).assignee).toBe("juanperez");
    expect(parseBoardFilters(new URLSearchParams("assignee=mine")).assignee).toBe("mine");
    expect(parseBoardFilters(new URLSearchParams("assignee=unassigned")).assignee).toBe("unassigned");
    expect(writeBoardFilters({ ...NO_FILTERS, assignee: "juanperez" }).toString()).toBe("assignee=juanperez");
  });

  it("ignores unknown values, deduplicates and orders priorities by rank", () => {
    const parsed = parseBoardFilters(
      new URLSearchParams(
        "availability=soon&assignee=not+a+login!&sort=random&priority=low&priority=bogus&priority=urgent&priority=low&stage=A&stage=A",
      ),
    );
    expect(parsed).toEqual({ ...NO_FILTERS, priorities: ["urgent", "low"], stages: ["A"] });
  });
});

describe("activeFilterCount / hasActiveFilters", () => {
  it("counts each narrowed dimension except the search, which has its own field", () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...NO_FILTERS, query: "x" })).toBe(0);
    expect(
      activeFilterCount({
        query: "",
        availability: "blocked",
        priorities: ["low", "high"],
        stages: ["A"],
        assignee: "mine",
        sort: "newest",
      }),
    ).toBe(4);
  });

  it("does not count the sort, which narrows nothing", () => {
    expect(activeFilterCount({ ...NO_FILTERS, sort: "updated" })).toBe(0);
    expect(hasActiveFilters({ ...NO_FILTERS, sort: "updated" })).toBe(false);
  });

  it("clears every filter but keeps the sort", () => {
    const filters: BoardFilters = {
      query: "x",
      availability: "blocked",
      priorities: ["low"],
      stages: ["A"],
      assignee: "mine",
      sort: "oldest",
    };
    expect(clearFilters(filters)).toEqual({ ...NO_FILTERS, sort: "oldest" });
  });

  it("treats a search as an active filter too", () => {
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...NO_FILTERS, query: " x " })).toBe(true);
    expect(hasActiveFilters({ ...NO_FILTERS, assignee: "unassigned" })).toBe(true);
    expect(activeFilterCount({ ...NO_FILTERS, assignee: "juan" })).toBe(1);
  });
});

describe("assigneeOptions", () => {
  const person = (login: string, name: string | null = null) => ({ login, name, avatarUrl: null });
  const participants = [person("zoe", "Zoe Z"), person("Anna", "Anna M"), person("bob")];
  const labels = (options: { value: string; label: string }[]) => options.map((o) => `${o.value}:${o.label}`);

  it("offers All, Mine and Unassigned, then the participants by login (named, else the login) but not the caller", () => {
    expect(labels(assigneeOptions(participants, [], "anna", "all"))).toEqual([
      "all:All",
      "mine:Mine",
      "unassigned:Unassigned",
      "bob:bob",
      "zoe:Zoe Z",
    ]);
  });

  it("adds assignees of the board who are no longer participants", () => {
    const tasks = [boardTask({ assignee: person("Carl", "Carl C") }), boardTask({ assignee: person("ZOE", "Zoe Z") })];
    expect(labels(assigneeOptions(participants, tasks, "anna", "all")).slice(3)).toEqual([
      "bob:bob",
      "carl:Carl C",
      "zoe:Zoe Z",
    ]);
  });

  it("keeps a selected login that matches nobody, so the URL never filters silently", () => {
    expect(labels(assigneeOptions(participants, [], "anna", "ghost")).slice(3)).toEqual([
      "bob:bob",
      "ghost:ghost",
      "zoe:Zoe Z",
    ]);
    expect(labels(assigneeOptions(participants, [], "anna", "anna")).slice(3)).toEqual([
      "anna:Anna M",
      "bob:bob",
      "zoe:Zoe Z",
    ]);
  });
});

describe("stageOptions", () => {
  it("lists the stages present, sorted, then 'No stage' when some task has none", () => {
    const tasks = [
      boardTask({ stage: "Etapa 2" }),
      boardTask({ stage: null }),
      boardTask({ stage: "Etapa 10" }),
      boardTask({ stage: "Etapa 2" }),
    ];
    expect(stageOptions(tasks)).toEqual([
      { value: "Etapa 2", label: "Etapa 2" },
      { value: "Etapa 10", label: "Etapa 10" },
      { value: NO_STAGE, label: "No stage" },
    ]);
  });

  it("keeps selected stages no task has any more, so they can be cleared", () => {
    expect(stageOptions([boardTask({ stage: "B" })], ["A"])).toEqual([
      { value: "A", label: "A" },
      { value: "B", label: "B" },
    ]);
  });
});

describe("waitingOn", () => {
  it("lists pending dependencies only for unassigned tasks", () => {
    expect(waitingOn(boardTask({ pendingDependencies: ["RF-13", "RF-15"] }))).toBe("RF-13, RF-15");
    expect(
      waitingOn(
        boardTask({ pendingDependencies: ["RF-13"], assignee: { login: "juan", name: null, avatarUrl: null } }),
      ),
    ).toBeUndefined();
    expect(waitingOn(boardTask({ pendingDependencies: [] }))).toBeUndefined();
  });
});
