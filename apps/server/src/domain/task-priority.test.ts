import { describe, expect, it } from "vitest";
import { comparePriority, TASK_PRIORITIES, type TaskPriority } from "./task-priority.ts";

describe("TASK_PRIORITIES", () => {
  it("lists priorities from most to least urgent", () => {
    expect(TASK_PRIORITIES).toEqual(["urgent", "high", "medium", "low"]);
  });
});

describe("comparePriority", () => {
  it("orders urgent < high < medium < low", () => {
    const shuffled: TaskPriority[] = ["low", "urgent", "medium", "high", "medium"];
    expect([...shuffled].sort(comparePriority)).toEqual(["urgent", "high", "medium", "medium", "low"]);
  });

  it("returns 0 for equal priorities", () => {
    expect(comparePriority("high", "high")).toBe(0);
  });

  it("is negative when the first priority is more urgent", () => {
    expect(comparePriority("urgent", "low")).toBeLessThan(0);
    expect(comparePriority("low", "urgent")).toBeGreaterThan(0);
  });
});
