import { describe, expect, it } from "vitest";
import type { BoardTask } from "../../api/types.ts";
import { boardTask } from "../../test/fixtures.ts";
import {
  activeFilterCount,
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
  it("reads nothing as no filters", () => {
    expect(parseBoardFilters(new URLSearchParams())).toEqual(NO_FILTERS);
  });

  it("round-trips every filter through the query string", () => {
    const filters: BoardFilters = {
      query: "login",
      availability: "ready",
      priorities: ["urgent", "low"],
      stages: ["Etapa 1 · Auth", NO_STAGE],
      assignee: "mine",
    };
    const params = writeBoardFilters(filters);
    expect(params.toString()).toBe(
      "q=login&availability=ready&priority=urgent&priority=low&stage=Etapa+1+%C2%B7+Auth&stage=&assignee=mine",
    );
    expect(parseBoardFilters(params)).toEqual(filters);
  });

  it("leaves defaults out of the URL and keeps unrelated parameters", () => {
    const params = writeBoardFilters({ ...NO_FILTERS, query: "  " }, new URLSearchParams("other=1&q=old&priority=low"));
    expect(params.toString()).toBe("other=1");
  });

  it("ignores unknown values, deduplicates and orders priorities by rank", () => {
    const parsed = parseBoardFilters(
      new URLSearchParams(
        "availability=soon&assignee=everyone&priority=low&priority=bogus&priority=urgent&priority=low&stage=A&stage=A",
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
      }),
    ).toBe(4);
  });

  it("treats a search as an active filter too", () => {
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...NO_FILTERS, query: " x " })).toBe(true);
    expect(hasActiveFilters({ ...NO_FILTERS, assignee: "unassigned" })).toBe(true);
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
