import { describe, expect, it } from "vitest";
import {
  compareTasks,
  dependentsOf,
  filterTasks,
  isBlocked,
  isReady,
  NO_TASK_FILTERS,
  type TaskFilters,
} from "./task-filters.ts";
import { listItem } from "./test-fixtures.ts";

const alice = { login: "Alice", name: null, avatarUrl: null };

describe("isReady / isBlocked", () => {
  it("is ready when unassigned, not done and without pending dependencies (ignores canTake)", () => {
    expect(isReady(listItem({ key: "A-1", canTake: false }))).toBe(true);
    expect(isReady(listItem({ key: "A-1", assignee: alice }))).toBe(false);
    expect(isReady(listItem({ key: "A-1", status: "done" }))).toBe(false);
    expect(isReady(listItem({ key: "A-1", pendingDependencies: ["A-2"] }))).toBe(false);
    expect(isReady(listItem({ key: "A-1", status: "in_review" }))).toBe(true);
  });

  it("is blocked when it has pending dependencies", () => {
    expect(isBlocked(listItem({ key: "A-1", pendingDependencies: ["A-2"] }))).toBe(true);
    expect(isBlocked(listItem({ key: "A-1", status: "blocked" }))).toBe(false);
  });
});

describe("compareTasks", () => {
  it("sorts by priority, then key number (RF-2 before RF-10, AUTH-08B after AUTH-08)", () => {
    const tasks = [
      listItem({ key: "RF-10", priority: "high" }),
      listItem({ key: "RF-2", priority: "high" }),
      listItem({ key: "RF-1", priority: "low" }),
      listItem({ key: "RF-3", priority: "urgent" }),
      listItem({ key: "MISC", priority: "medium" }),
      listItem({ key: "AUTH-08B", priority: "medium" }),
      listItem({ key: "AUTH-08", priority: "medium" }),
    ];
    expect(tasks.sort(compareTasks).map((t) => t.key)).toEqual([
      "RF-3",
      "RF-2",
      "RF-10",
      "AUTH-08",
      "AUTH-08B",
      "MISC",
      "RF-1",
    ]);
  });
});

describe("filterTasks", () => {
  const tasks = [
    listItem({ key: "RF-1", title: "Login page", status: "done", priority: "high", stage: "Etapa 1" }),
    listItem({ key: "RF-2", title: "Board", status: "in_progress", priority: "urgent", stage: "Etapa 2", assignee: alice }),
    listItem({ key: "RF-3", title: "Search box", priority: "low", pendingDependencies: ["RF-2"], dependsOn: ["RF-2"] }),
    listItem({ key: "RF-4", title: "Export", priority: "medium", stage: "Etapa 2" }),
  ];
  const keys = (filters: Partial<TaskFilters>) =>
    filterTasks(tasks, { ...NO_TASK_FILTERS, ...filters }).map((t) => t.key);

  it("keeps everything without filters", () => {
    expect(keys({})).toEqual(["RF-1", "RF-2", "RF-3", "RF-4"]);
  });

  it("filters by availability", () => {
    expect(keys({ availability: "ready" })).toEqual(["RF-4"]);
    expect(keys({ availability: "blocked" })).toEqual(["RF-3"]);
  });

  it("filters by status, priority and stage (any of each; empty stage means no stage)", () => {
    expect(keys({ statuses: ["done", "todo"] })).toEqual(["RF-1", "RF-3", "RF-4"]);
    expect(keys({ priorities: ["urgent", "low"] })).toEqual(["RF-2", "RF-3"]);
    expect(keys({ stages: ["etapa 2"] })).toEqual(["RF-2", "RF-4"]);
    expect(keys({ stages: [""] })).toEqual(["RF-3"]);
  });

  it("filters by assignee: unassigned or a login (case-insensitive, optional @)", () => {
    expect(keys({ assignee: "unassigned" })).toEqual(["RF-1", "RF-3", "RF-4"]);
    expect(keys({ assignee: "@alice" })).toEqual(["RF-2"]);
    expect(keys({ assignee: "any" })).toHaveLength(4);
  });

  it("searches key and title case-insensitively", () => {
    expect(keys({ search: "  BOX " })).toEqual(["RF-3"]);
    expect(keys({ search: "rf-4" })).toEqual(["RF-4"]);
  });

  it("combines filters with AND", () => {
    expect(keys({ stages: ["Etapa 2"], assignee: "unassigned" })).toEqual(["RF-4"]);
  });
});

describe("dependentsOf", () => {
  it("lists the keys of tasks that depend on the given one, sorted by key", () => {
    const tasks = [
      listItem({ key: "RF-10", dependsOn: ["RF-1"] }),
      listItem({ key: "RF-2", dependsOn: ["rf-1", "RF-3"] }),
      listItem({ key: "RF-1" }),
    ];
    expect(dependentsOf(tasks, "RF-1")).toEqual(["RF-2", "RF-10"]);
    expect(dependentsOf(tasks, "RF-2")).toEqual([]);
  });
});
