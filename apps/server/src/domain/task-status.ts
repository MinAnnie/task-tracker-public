export const TASK_STATUSES = ["todo", "in_progress", "in_review", "done", "blocked"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PR_EVENTS = ["opened", "reopened", "closed_unmerged", "merged"] as const;
export type PrEvent = (typeof PR_EVENTS)[number];
