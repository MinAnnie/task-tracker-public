import { describe, expect, it } from "vitest";
import { nextTaskStatus } from "./next-task-status.ts";
import { TASK_STATUSES, type TaskStatus } from "./task-status.ts";

const notDone = TASK_STATUSES.filter((s): s is Exclude<TaskStatus, "done"> => s !== "done");

describe("nextTaskStatus", () => {
  describe("when a PR is opened or reopened", () => {
    it.each(notDone.flatMap((status) => [
      [status, "opened"],
      [status, "reopened"],
    ] as const))("moves %s to in_review on %s", (current, event) => {
      expect(nextTaskStatus(current, event)).toBe("in_review");
    });

    it.each(["opened", "reopened"] as const)("keeps a done task done on %s", (event) => {
      expect(nextTaskStatus("done", event)).toBe("done");
    });
  });

  describe("when a PR is merged", () => {
    it.each(TASK_STATUSES)("moves %s to done", (current) => {
      expect(nextTaskStatus(current, "merged")).toBe("done");
    });
  });

  describe("when a PR is closed without merging", () => {
    it("moves in_review back to in_progress", () => {
      expect(nextTaskStatus("in_review", "closed_unmerged")).toBe("in_progress");
    });

    it.each(["todo", "in_progress", "blocked"] as const)("leaves %s unchanged", (current) => {
      expect(nextTaskStatus(current, "closed_unmerged")).toBe(current);
    });

    it("never moves a done task out of done", () => {
      expect(nextTaskStatus("done", "closed_unmerged")).toBe("done");
    });
  });
});
