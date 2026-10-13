import { TASK_PRIORITIES, type PullRequestState, type TaskPriority, type TaskStatus } from "./types.ts";

// Mirrors apps/web/src/lib/task-labels.ts; duplicated so this package does not depend on web code.

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  blocked: "Blocked",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const PULL_REQUEST_STATE_LABELS: Record<PullRequestState, string> = {
  open: "Open",
  merged: "Merged",
  closed: "Closed",
};

/** More urgent first. */
export const comparePriority = (a: TaskPriority, b: TaskPriority) =>
  TASK_PRIORITIES.indexOf(a) - TASK_PRIORITIES.indexOf(b);

const keyNumber = (key: string) => Number(/-(\d+)[A-Z]?$/i.exec(key)?.[1] ?? Number.POSITIVE_INFINITY);

/** Orders `RF-2` before `RF-10` and `AUTH-08B` right after `AUTH-08`; keys without a number go last. */
export const compareTaskKeys = (a: string, b: string) => keyNumber(a) - keyNumber(b) || a.localeCompare(b);
