/** Task priorities, from most to least urgent. */
export const TASK_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Sort comparator: more urgent priorities come first (urgent < high < medium < low). */
export function comparePriority(a: TaskPriority, b: TaskPriority): number {
  return TASK_PRIORITIES.indexOf(a) - TASK_PRIORITIES.indexOf(b);
}
