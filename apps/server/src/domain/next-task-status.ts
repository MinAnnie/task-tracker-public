import type { PrEvent, TaskStatus } from "./task-status.ts";

/**
 * Computes a task's status after an event on a linked pull request.
 *
 * - opened / reopened -> in_review
 * - merged            -> done
 * - closed_unmerged   -> in_progress if the task was in_review, otherwise unchanged
 * - A done task is never moved out of done automatically.
 */
export function nextTaskStatus(current: TaskStatus, event: PrEvent): TaskStatus {
  if (current === "done") return "done";
  switch (event) {
    case "opened":
    case "reopened":
      return "in_review";
    case "merged":
      return "done";
    case "closed_unmerged":
      return current === "in_review" ? "in_progress" : current;
  }
}
