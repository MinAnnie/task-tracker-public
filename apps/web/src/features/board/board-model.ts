import { TASK_PRIORITIES, TASK_STATUSES, type BoardTask, type TaskPriority, type TaskStatus } from "../../api/types.ts";
import { comparePriority, compareTaskKeys, STATUS_LABELS } from "../../lib/task-labels.ts";

export interface BoardColumn {
  status: TaskStatus;
  label: string;
  tasks: BoardTask[];
}

export type Availability = "any" | "ready" | "blocked";
export type AssigneeFilter = "all" | "mine" | "unassigned";
/** Order of the tasks in each column; ties fall back to priority, then key number. */
export type BoardSort = "priority" | "newest" | "oldest" | "updated";

/** The stage filter value that stands for tasks without a stage. */
export const NO_STAGE = "";

/** What the board shows (every filter narrows it further, AND) and in which order. */
export interface BoardFilters {
  /** Free text matched against the key and the title. */
  query: string;
  /** `ready`: the server says it can be taken; `blocked`: it has pending dependencies. */
  availability: Availability;
  /** Any of these priorities; empty means any priority. */
  priorities: TaskPriority[];
  /** Any of these stages ({@link NO_STAGE} for none); empty means any stage. */
  stages: string[];
  assignee: AssigneeFilter;
  /** Not a filter: it narrows nothing, so it is not counted and survives clearing. */
  sort: BoardSort;
}

export const NO_FILTERS: BoardFilters = {
  query: "",
  availability: "any",
  priorities: [],
  stages: [],
  assignee: "all",
  sort: "priority",
};

const AVAILABILITIES: readonly Availability[] = ["any", "ready", "blocked"];
const ASSIGNEES: readonly AssigneeFilter[] = ["all", "mine", "unassigned"];
const SORTS: readonly BoardSort[] = ["priority", "newest", "oldest", "updated"];
/** Query string parameters the filters own. */
const PARAMS = {
  query: "q",
  availability: "availability",
  priority: "priority",
  stage: "stage",
  assignee: "assignee",
  sort: "sort",
};

const oneOf = <T extends string>(allowed: readonly T[], value: string | null, fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/** Reads the filters from a query string; unknown values fall back to "no filter". */
export function parseBoardFilters(params: URLSearchParams): BoardFilters {
  const priorities = new Set(params.getAll(PARAMS.priority));
  return {
    query: params.get(PARAMS.query) ?? "",
    availability: oneOf(AVAILABILITIES, params.get(PARAMS.availability), "any"),
    priorities: TASK_PRIORITIES.filter((priority) => priorities.has(priority)),
    stages: [...new Set(params.getAll(PARAMS.stage))],
    assignee: oneOf(ASSIGNEES, params.get(PARAMS.assignee), "all"),
    sort: oneOf(SORTS, params.get(PARAMS.sort), "priority"),
  };
}

/** Writes the filters into a copy of `base`, leaving defaults (and the base's other parameters) out. */
export function writeBoardFilters(filters: BoardFilters, base = new URLSearchParams()): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const name of Object.values(PARAMS)) params.delete(name);
  if (filters.query.trim() !== "") params.set(PARAMS.query, filters.query);
  if (filters.availability !== "any") params.set(PARAMS.availability, filters.availability);
  for (const priority of filters.priorities) params.append(PARAMS.priority, priority);
  for (const stage of filters.stages) params.append(PARAMS.stage, stage);
  if (filters.assignee !== "all") params.set(PARAMS.assignee, filters.assignee);
  if (filters.sort !== "priority") params.set(PARAMS.sort, filters.sort);
  return params;
}

/** How many filters narrow the board, not counting the search (it has its own field). */
export function activeFilterCount(filters: BoardFilters): number {
  return [
    filters.availability !== "any",
    filters.priorities.length > 0,
    filters.stages.length > 0,
    filters.assignee !== "all",
  ].filter(Boolean).length;
}

export const hasActiveFilters = (filters: BoardFilters) =>
  filters.query.trim() !== "" || activeFilterCount(filters) > 0;

/** No filter at all, keeping the chosen sort. */
export const clearFilters = (filters: BoardFilters): BoardFilters => ({ ...NO_FILTERS, sort: filters.sort });

/**
 * The stages to offer: those of the tasks plus any already selected, sorted
 * naturally ("Etapa 2" before "Etapa 10"), with "No stage" last when it applies.
 */
export function stageOptions(
  tasks: readonly BoardTask[],
  selected: readonly string[] = [],
): { value: string; label: string }[] {
  const stages = new Set<string>(selected);
  for (const task of tasks) stages.add(task.stage ?? NO_STAGE);
  const named = [...stages]
    .filter((stage) => stage !== NO_STAGE)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map((stage) => ({ value: stage, label: stage }));
  return stages.has(NO_STAGE) ? [...named, { value: NO_STAGE, label: "No stage" }] : named;
}

export const compareBoardTasks = (a: BoardTask, b: BoardTask) =>
  comparePriority(a.priority, b.priority) || compareTaskKeys(a.key, b.key);

const time = (iso: string) => Date.parse(iso);

const SORT_COMPARATORS: Record<BoardSort, (a: BoardTask, b: BoardTask) => number> = {
  priority: compareBoardTasks,
  newest: (a, b) => time(b.createdAt) - time(a.createdAt) || compareBoardTasks(a, b),
  oldest: (a, b) => time(a.createdAt) - time(b.createdAt) || compareBoardTasks(a, b),
  updated: (a, b) => time(b.updatedAt) - time(a.updatedAt) || compareBoardTasks(a, b),
};

/** One column per status, in board order, each sorted by `sort` (priority then key number by default). */
export function groupByStatus(tasks: readonly BoardTask[], sort: BoardSort = "priority"): BoardColumn[] {
  return TASK_STATUSES.map((status) => ({
    status,
    label: STATUS_LABELS[status],
    tasks: tasks.filter((task) => task.status === status).sort(SORT_COMPARATORS[sort]),
  }));
}

const matchesAvailability = (task: BoardTask, availability: Availability) =>
  availability === "any" || (availability === "ready" ? task.canTake : task.pendingDependencies.length > 0);

const matchesAssignee = (task: BoardTask, assignee: AssigneeFilter, me: string) =>
  assignee === "all" ||
  (assignee === "unassigned" ? task.assignee === null : task.assignee?.login.toLowerCase() === me.toLowerCase());

/** The tasks that pass every filter; `me` is the signed-in user's login. */
export function filterTasks(tasks: readonly BoardTask[], filters: BoardFilters, me: string): BoardTask[] {
  const needle = filters.query.trim().toLowerCase();
  return tasks.filter(
    (task) =>
      (needle === "" || task.key.toLowerCase().includes(needle) || task.title.toLowerCase().includes(needle)) &&
      matchesAvailability(task, filters.availability) &&
      (filters.priorities.length === 0 || filters.priorities.includes(task.priority)) &&
      (filters.stages.length === 0 || filters.stages.includes(task.stage ?? NO_STAGE)) &&
      matchesAssignee(task, filters.assignee, me),
  );
}

/** The pending dependencies an unassigned task waits on ("RF-13, RF-15"), if any. */
export function waitingOn(task: BoardTask): string | undefined {
  if (task.assignee !== null || task.pendingDependencies.length === 0) return undefined;
  return task.pendingDependencies.join(", ");
}
