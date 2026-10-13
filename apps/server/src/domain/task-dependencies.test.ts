import { describe, expect, it } from "vitest";
import { isDependencyPending, pendingDependencies, wouldCreateCycle } from "./task-dependencies.ts";

/** Builds edges from `[taskId, dependsOnTaskId]` pairs. */
const edges = (...pairs: [number, number][]) =>
  pairs.map(([taskId, dependsOnTaskId]) => ({ taskId, dependsOnTaskId }));

describe("wouldCreateCycle", () => {
  it("is false for a graph without edges", () => {
    expect(wouldCreateCycle([], 1, 2)).toBe(false);
  });

  it("is true for a self-dependency", () => {
    expect(wouldCreateCycle([], 1, 1)).toBe(true);
  });

  it("is true when the target already depends on the source directly", () => {
    expect(wouldCreateCycle(edges([2, 1]), 1, 2)).toBe(true);
  });

  it("is true when the target reaches the source transitively", () => {
    // 3 -> 2 -> 1; adding 1 -> 3 closes the loop.
    expect(wouldCreateCycle(edges([3, 2], [2, 1]), 1, 3)).toBe(true);
  });

  it("is false for a diamond that stays acyclic", () => {
    // 1 -> 2, 1 -> 3, 2 -> 4; adding 3 -> 4 is fine.
    expect(wouldCreateCycle(edges([1, 2], [1, 3], [2, 4]), 3, 4)).toBe(false);
  });

  it("is false when the same edge already exists", () => {
    expect(wouldCreateCycle(edges([1, 2]), 1, 2)).toBe(false);
  });

  it("ignores unrelated components", () => {
    expect(wouldCreateCycle(edges([5, 6], [6, 7]), 1, 5)).toBe(false);
  });

  it("terminates on graphs that already contain a cycle", () => {
    expect(wouldCreateCycle(edges([5, 6], [6, 5]), 1, 5)).toBe(false);
    expect(wouldCreateCycle(edges([5, 6], [6, 5], [6, 1]), 1, 5)).toBe(true);
  });
});

describe("isDependencyPending", () => {
  it.each([["todo"], ["in_progress"], ["in_review"], ["blocked"]] as const)("is true for %s", (status) => {
    expect(isDependencyPending(status)).toBe(true);
  });

  it("is false for done", () => {
    expect(isDependencyPending("done")).toBe(false);
  });
});

describe("pendingDependencies", () => {
  it("returns the keys of dependencies that are not done, in order", () => {
    expect(
      pendingDependencies([
        { key: "RF-1", status: "done" },
        { key: "RF-3", status: "in_review" },
        { key: "RF-2", status: "todo" },
      ]),
    ).toEqual(["RF-3", "RF-2"]);
  });

  it("is empty without dependencies or when all are done", () => {
    expect(pendingDependencies([])).toEqual([]);
    expect(pendingDependencies([{ key: "RF-1", status: "done" }])).toEqual([]);
  });
});
