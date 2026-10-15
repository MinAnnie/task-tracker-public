import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type BoardTask,
  type Participant,
  type TaskPriority,
  type TaskStatus,
} from "../../api/types.ts";
import { comparePriority, compareTaskKeys, STATUS_LABELS } from "../../lib/task-labels.ts";

export interface BoardColumn {
  status: TaskStatus;
  label: string;
  tasks: BoardTask[];
}

export type Availability = "any" | "ready" | "blocked";
type AssigneeKeyword = "all" | "mine" | "unassigned";
/** A keyword, or the lowercased GitHub login of one member. */
export type AssigneeFilter = AssigneeKeyword | (string & {});
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
const ASSIGNEE_KEYWORDS: readonly AssigneeKeyword[] = ["all", "mine", "unassigned"];
/** GitHub login rules: alphanumerics and single inner hyphens, at most 39 characters. */
const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
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

function parseAssignee(value: string | null): AssigneeFilter {
  if (ASSIGNEE_KEYWORDS.includes(value as AssigneeKeyword)) return value as AssigneeKeyword;
  return value !== null && GITHUB_LOGIN.test(value) ? value.toLowerCase() : "all";
}

/** Reads the filters from a query string; unknown values fall back to "no filter". */
export function parseBoardFilters(params: URLSearchParams): BoardFilters {
  const priorities = new Set(params.getAll(PARAMS.priority));
  return {
    query: params.get(PARAMS.query) ?? "",
    availability: oneOf(AVAILABILITIES, params.get(PARAMS.availability), "any"),
    priorities: TASK_PRIORITIES.filter((priority) => priorities.has(priority)),
    stages: [...new Set(params.getAll(PARAMS.stage))],
    assignee: parseAssignee(params.get(PARAMS.assignee)),
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
 * The assignee choices: All, Mine, Unassigned, then each person by login, labelled by
 * name (else login). People are the project participants plus anyone assigned on the
 * board (a removed member, say) and the selected login even when it matches nobody, so
 * a URL never filters silently. The caller is left out (Mine covers them) unless selected.
 */
export function assigneeOptions(
  participants: readonly Participant[],
  tasks: readonly BoardTask[],
  me: string,
  selected: AssigneeFilter,
): { value: AssigneeFilter; label: string }[] {
  const people = new Map<string, string>();
  const add = (login: string, name: string | null) => {
    const value = login.toLowerCase();
    if (!people.has(value)) people.set(value, name ?? login);
  };
  for (const person of participants) add(person.login, person.name);
  for (const task of tasks) if (task.assignee) add(task.assignee.login, task.assignee.name);
  if (!ASSIGNEE_KEYWORDS.includes(selected as AssigneeKeyword)) add(selected, null);
  if (selected !== me.toLowerCase()) people.delete(me.toLowerCase());
  const others = [...people]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([value, label]) => ({ value, label }));
  return [
    { value: "all", label: "All" },
    { value: "mine", label: "Mine" },
    { value: "unassigned", label: "Unassigned" },
    ...others,
  ];
}

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

function matchesAssignee(task: BoardTask, assignee: AssigneeFilter, me: string): boolean {
  if (assignee === "all") return true;
  if (assignee === "unassigned") return task.assignee === null;
  const login = assignee === "mine" ? me : assignee;
  return task.assignee?.login.toLowerCase() === login.toLowerCase();
}

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
