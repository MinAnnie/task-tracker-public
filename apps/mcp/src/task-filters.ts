import { comparePriority, compareTaskKeys } from "./labels.ts";
import type { TaskListItem, TaskPriority, TaskStatus } from "./types.ts";

export type Availability = "any" | "ready" | "blocked";

/** What `list_tasks` narrows the board by; every field applies (AND). */
export interface TaskFilters {
  availability: Availability;
  /** Any of these statuses; empty means any. */
  statuses: readonly TaskStatus[];
  /** Any of these priorities; empty means any. */
  priorities: readonly TaskPriority[];
  /** Any of these stages, case-insensitively (`""` for tasks without a stage); empty means any. */
  stages: readonly string[];
  /** `any`, `unassigned` or a GitHub login (case-insensitive, optional leading `@`). */
  assignee: string;
  /** Free text matched against the key and the title. */
  search: string;
}

export const NO_TASK_FILTERS: TaskFilters = {
  availability: "any",
  statuses: [],
  priorities: [],
  stages: [],
  assignee: "any",
  search: "",
};

/**
 * Whether anyone could pick the task up now: unassigned, not done and with no pending
 * dependency. Computed here because the API always answers `canTake: false` to tokens.
 */
export const isReady = (task: TaskListItem) =>
  task.assignee === null && task.status !== "done" && task.pendingDependencies.length === 0;

/** Whether the task waits on dependencies that are not done yet. */
export const isBlocked = (task: TaskListItem) => task.pendingDependencies.length > 0;

/** Board order: priority (most urgent first), then key number. */
export const compareTasks = (a: TaskListItem, b: TaskListItem) =>
  comparePriority(a.priority, b.priority) || compareTaskKeys(a.key, b.key);

const matchesAssignee = (task: TaskListItem, assignee: string) => {
  const wanted = assignee.trim().replace(/^@/, "").toLowerCase();
  if (wanted === "" || wanted === "any") return true;
  if (wanted === "unassigned") return task.assignee === null;
  return task.assignee?.login.toLowerCase() === wanted;
};

export function filterTasks(tasks: readonly TaskListItem[], filters: TaskFilters): TaskListItem[] {
  const needle = filters.search.trim().toLowerCase();
  const stages = filters.stages.map((stage) => stage.trim().toLowerCase());
  return tasks.filter(
    (task) =>
      (filters.availability === "any" || (filters.availability === "ready" ? isReady(task) : isBlocked(task))) &&
      (filters.statuses.length === 0 || filters.statuses.includes(task.status)) &&
      (filters.priorities.length === 0 || filters.priorities.includes(task.priority)) &&
      (stages.length === 0 || stages.includes((task.stage ?? "").toLowerCase())) &&
      matchesAssignee(task, filters.assignee) &&
      (needle === "" || task.key.toLowerCase().includes(needle) || task.title.toLowerCase().includes(needle)),
  );
}

/** Keys of the tasks that depend on `key` (case-insensitive), sorted by key. */
export function dependentsOf(tasks: readonly TaskListItem[], key: string): string[] {
  const wanted = key.toLowerCase();
  return tasks
    .filter((task) => task.dependsOn.some((dependency) => dependency.toLowerCase() === wanted))
    .map((task) => task.key)
    .sort(compareTaskKeys);
}
