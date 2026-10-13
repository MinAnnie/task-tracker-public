import {
  formatTaskKey,
  isDependencyPending,
  nextTaskKeyNumber,
  normalizeProjectSlug,
  normalizeTaskDescription,
  normalizeTaskPriority,
  normalizeTaskStage,
  normalizeTaskTitle,
  TASK_PRIORITIES,
  wouldCreateCycle,
  type TaskDependencyEdge,
  type TaskPriority,
} from "../domain/index.ts";
import { notificationTarget, type NotificationEvent, type NotificationPublisher } from "./notifications.ts";
import type { TaskProjectRecord, TaskRecord, TaskStore } from "./task-store.ts";

export interface ImportTasksDeps {
  store: TaskStore;
  /** Receives the import summary once the transaction committed. */
  notifications: NotificationPublisher;
}

/**
 * A problem with the import file; `task` is the 1-based position of the offending task,
 * `dependency` that of the offending `dependencies` entry; both `null` for the file.
 */
export interface ImportError {
  task: number | null;
  dependency?: number;
  /** The task's key or ref, when it has a usable one. */
  id: string | null;
  message: string;
}

export interface PlannedTask {
  key: string;
  /** The local identifier the key was generated for; `null` for explicit keys. */
  ref: string | null;
  title: string;
  priority: TaskPriority;
  status: ImportedTaskStatus;
  /** Keys of the tasks it depends on, in file order. */
  dependsOn: string[];
}

export interface ImportPlan {
  projectSlug: string;
  /** In file order, which is also creation order. */
  tasks: PlannedTask[];
  explicitKeyCount: number;
  dependencyCount: number;
  /** Keys of the imported tasks without dependencies. */
  roots: string[];
  /** Edges of the `dependencies` section to write, by key, in file order. */
  addedDependencies: { task: string; dependsOn: string }[];
  /** Edges of the `dependencies` section skipped because they already exist. */
  alreadyPresentDependencyCount: number;
}

export type ImportTasksResult =
  | { status: "project_not_found" }
  | { status: "invalid"; errors: ImportError[] }
  | { status: "planned"; plan: ImportPlan }
  | { status: "imported"; plan: ImportPlan };

/** Statuses a task can be imported with; `in_progress` and `in_review` need an assignee. */
export const IMPORTED_TASK_STATUSES = ["todo", "done", "blocked"] as const;
export type ImportedTaskStatus = (typeof IMPORTED_TASK_STATUSES)[number];

/**
 * `RF-02` or `AUTH-08B`: 1–10 letters or digits starting with a letter, a hyphen, digits
 * and an optional letter (after uppercasing).
 */
const EXPLICIT_KEY = /^[A-Z][A-Z0-9]{0,9}-\d+[A-Z]?$/;
const REF_MAX_LENGTH = 100;
const FILE_PROPERTIES = new Set(["tasks", "dependencies"]);
const DEPENDENCY_PROPERTIES = new Set(["task", "dependsOn"]);
const TASK_PROPERTIES = new Set(["key", "ref", "title", "description", "priority", "stage", "dependsOn", "status"]);
const UNASSIGNED_STATUS_ERROR =
  "imported tasks can't be in_progress/in_review because they have no assignee; import as todo and take them in the app";

const isImportedStatus = (value: unknown): value is ImportedTaskStatus =>
  (IMPORTED_TASK_STATUSES as readonly unknown[]).includes(value);

/** One line per error: `task #3 (monorepo): unknown dependency "x"`. */
export function formatImportError({ task, dependency, id, message }: ImportError): string {
  const label = id === null ? "" : ` (${id})`;
  if (dependency !== undefined) return `dependency #${dependency}${label}: ${message}`;
  if (task === null) return `file: ${message}`;
  return `task #${task}${label}: ${message}`;
}

/** A task of the file whose fields are valid; its dependencies are resolved later. */
interface ParsedTask {
  position: number;
  /** Uppercased explicit key, or `undefined` for a ref task. */
  key: string | undefined;
  ref: string | undefined;
  title: string;
  description: string | null;
  priority: TaskPriority;
  stage: string | null;
  status: ImportedTaskStatus;
  dependsOn: string[];
}

/** A dependency target, as written in `dependsOn`: another task of the file (by index) or an existing task. */
type Target = { item: string } & ({ kind: "file"; index: number } | { kind: "existing"; task: TaskRecord });

interface ValidTask extends ParsedTask {
  targets: Target[];
}

/** An edge of the `dependencies` section, to be written after the file's tasks. */
interface ExtraEdge {
  task: Target;
  dependsOn: Target;
}

interface ValidImport {
  tasks: ValidTask[];
  extraEdges: ExtraEdge[];
  alreadyPresentCount: number;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const identifier = (value: string) => value.toUpperCase();

/**
 * Validates the whole file against the project and resolves every dependency. Collects
 * every error instead of stopping at the first one.
 */
function validate(
  input: unknown,
  existing: readonly TaskRecord[],
  existingEdges: readonly TaskDependencyEdge[],
): ({ ok: true } & ValidImport) | { ok: false; errors: ImportError[] } {
  const errors: ImportError[] = [];
  const fileError = (message: string) => ({ ok: false as const, errors: [{ task: null, id: null, message }] });
  if (!isObject(input) || (input.tasks !== undefined && !Array.isArray(input.tasks))) {
    return fileError('must be a JSON object with a "tasks" array');
  }
  if (input.dependencies !== undefined && !Array.isArray(input.dependencies)) {
    return fileError('"dependencies" must be an array');
  }
  const rawTasks: unknown[] = input.tasks ?? [];
  const rawDependencies: unknown[] = input.dependencies ?? [];
  for (const property of Object.keys(input)) {
    if (!FILE_PROPERTIES.has(property)) errors.push({ task: null, id: null, message: `unknown property "${property}"` });
  }
  if (rawTasks.length === 0 && rawDependencies.length === 0) {
    errors.push({
      task: null,
      id: null,
      message: input.tasks === undefined ? 'needs a "tasks" or "dependencies" array' : '"tasks" is empty',
    });
  }

  const existingByKey = new Map(existing.map((task) => [identifier(task.key), task]));
  /** Index in the file of every key or ref seen so far, by uppercased identifier. */
  const fileIds = new Map<string, number>();
  /** Every task's dependencies (when readable) and, when all its fields are valid, the task. */
  const parsed = rawTasks.map((
    raw,
    index,
  ): { id: string | null; dependsOn: string[]; status?: ImportedTaskStatus; task?: ParsedTask } => {
    const position = index + 1;
    const fail = (id: string | null, message: string) => errors.push({ task: position, id, message });
    if (!isObject(raw)) {
      fail(null, "must be an object");
      return { id: null, dependsOn: [] };
    }

    const { id, key, ref } = parseIdentity(raw, (message, label = null) => fail(label, message));
    let valid = id !== null;
    const error = (message: string) => {
      fail(id, message);
      valid = false;
    };
    for (const property of Object.keys(raw)) {
      if (!TASK_PROPERTIES.has(property)) error(`unknown property "${property}"`);
    }

    if (id !== null) {
      const upper = identifier(id);
      const previous = fileIds.get(upper);
      const clash = existingByKey.get(upper);
      if (previous !== undefined) error(`"${id}" is already used by task #${previous + 1}`);
      else fileIds.set(upper, index);
      if (clash !== undefined) {
        error(key !== undefined ? `key "${key}" already exists in the project` : `ref "${ref}" clashes with existing key "${clash.key}"`);
      }
    }

    const title = normalizeTaskTitle(raw.title);
    if (title === undefined) error('"title" must have 1–200 characters');
    const description = raw.description === undefined ? null : normalizeTaskDescription(raw.description);
    if (description === undefined) error('"description" must be a string of at most 10000 characters');
    const priority = raw.priority === undefined ? "medium" : normalizeTaskPriority(raw.priority);
    if (priority === undefined) error(`"priority" must be one of ${TASK_PRIORITIES.join(", ")}`);
    const stage = raw.stage === undefined ? null : normalizeTaskStage(raw.stage);
    if (stage === undefined) error('"stage" must be a string of at most 50 characters');
    const status = raw.status === undefined ? "todo" : isImportedStatus(raw.status) ? raw.status : undefined;
    if (raw.status === "in_progress" || raw.status === "in_review") error(UNASSIGNED_STATUS_ERROR);
    else if (status === undefined) error(`"status" must be one of ${IMPORTED_TASK_STATUSES.join(", ")}`);
    let dependsOn: string[] = [];
    if (Array.isArray(raw.dependsOn) && raw.dependsOn.every((item) => typeof item === "string")) {
      dependsOn = raw.dependsOn;
    } else if (raw.dependsOn !== undefined) {
      error('"dependsOn" must be an array of keys or refs');
    }

    if (
      !valid ||
      title === undefined ||
      description === undefined ||
      priority === undefined ||
      stage === undefined ||
      status === undefined
    ) {
      return { id, dependsOn, status };
    }
    return { id, dependsOn, status, task: { position, key, ref, title, description, priority, stage, status, dependsOn } };
  });

  /** Resolves a key or ref: tasks of the file first, then existing tasks (case-insensitive). */
  const resolve = (item: string): Target | undefined => {
    const upper = identifier(item.trim());
    const fileIndex = fileIds.get(upper);
    if (fileIndex !== undefined) return { item, kind: "file", index: fileIndex };
    const existingTask = existingByKey.get(upper);
    return existingTask && { item, kind: "existing", task: existingTask };
  };
  const statusOf = (target: Target) => (target.kind === "file" ? parsed[target.index]!.status : target.task.status);

  // Dependencies of invalid tasks are resolved too, so every error shows up at once.
  const resolved = parsed.map(({ id, dependsOn, status, task }, index): ValidTask | undefined => {
    const position = index + 1;
    const targets: Target[] = [];
    const seen = new Set<string>();
    for (const item of dependsOn) {
      const target = resolve(item);
      if (target === undefined) {
        errors.push({ task: position, id, message: `unknown dependency "${item}"` });
        continue;
      }
      if (target.kind === "file" && target.index === index) {
        errors.push({ task: position, id, message: "depends on itself" });
        continue;
      }
      const targetId = target.kind === "file" ? `#${target.index}` : `id:${target.task.id}`;
      if (seen.has(targetId)) continue;
      seen.add(targetId);
      targets.push(target);
    }
    // A done task can't wait on unfinished work. Unknown statuses (invalid tasks) already have errors.
    if (status === "done") {
      const pending = targets
        .filter((target) => {
          const targetStatus = statusOf(target);
          return targetStatus !== undefined && isDependencyPending(targetStatus);
        })
        .map((target) => target.item);
      if (pending.length > 0) {
        errors.push({ task: position, id, message: `is done but depends on tasks that are not done: ${pending.join(", ")}` });
      }
    }
    return task && { ...task, targets };
  });

  // Existing tasks never depend on new ones, but checking the combined graph keeps the
  // rule identical to adding the edges one by one. New tasks get negative node ids.
  const node = (target: Target) => (target.kind === "file" ? -(target.index + 1) : target.task.id);
  const edges: TaskDependencyEdge[] = [...existingEdges];
  resolved.forEach((task, index) => {
    if (task === undefined) return;
    const from = -(index + 1);
    task.targets = task.targets.filter((target) => {
      const to = node(target);
      if (wouldCreateCycle(edges, from, to)) {
        errors.push({
          task: task.position,
          id: task.key ?? task.ref ?? null,
          message: `depending on "${target.item}" closes a dependency cycle`,
        });
        return false;
      }
      edges.push({ taskId: from, dependsOnTaskId: to });
      return true;
    });
  });

  const { extraEdges, alreadyPresentCount } = validateDependencyEntries(rawDependencies, {
    resolve,
    statusOf,
    node,
    edges,
    existingEdges,
    errors,
  });

  if (errors.length > 0) {
    // File-level errors first, then by task, then by dependency entry; stable, so each keeps its own order.
    const rank = (error: ImportError) => (error.dependency !== undefined ? rawTasks.length + error.dependency : (error.task ?? 0));
    errors.sort((a, b) => rank(a) - rank(b));
    return { ok: false, errors };
  }
  return { ok: true, tasks: resolved as ValidTask[], extraEdges, alreadyPresentCount };
}

/**
 * Validates the `dependencies` section: resolves every edge, skips (and counts) the ones
 * that already exist in the project, merges duplicates (also of the file's tasks' own
 * edges), applies the done-task rule and checks cycles against `edges`, the whole graph
 * so far (existing edges plus the file's tasks' edges), which it extends.
 */
function validateDependencyEntries(
  entries: readonly unknown[],
  context: {
    resolve: (item: string) => Target | undefined;
    statusOf: (target: Target) => ImportedTaskStatus | TaskRecord["status"] | undefined;
    node: (target: Target) => number;
    edges: TaskDependencyEdge[];
    existingEdges: readonly TaskDependencyEdge[];
    errors: ImportError[];
  },
): { extraEdges: ExtraEdge[]; alreadyPresentCount: number } {
  const { resolve, statusOf, node, edges, errors } = context;
  const edgeId = (from: number, to: number) => `${from}>${to}`;
  const existing = new Set(context.existingEdges.map((e) => edgeId(e.taskId, e.dependsOnTaskId)));
  /** The file's tasks' edges and the entries' edges so far, to merge duplicates. */
  const seen = new Set(edges.map((e) => edgeId(e.taskId, e.dependsOnTaskId)));
  const countedPresent = new Set<string>();
  const extraEdges: ExtraEdge[] = [];
  let alreadyPresentCount = 0;

  entries.forEach((raw, index) => {
    const dependency = index + 1;
    if (!isObject(raw) || typeof raw.task !== "string") {
      errors.push({ task: null, dependency, id: null, message: 'must be an object with "task" and "dependsOn"' });
      return;
    }
    const id = raw.task.trim();
    const fail = (message: string) => errors.push({ task: null, dependency, id, message });
    for (const property of Object.keys(raw)) {
      if (!DEPENDENCY_PROPERTIES.has(property)) fail(`unknown property "${property}"`);
    }
    const task = resolve(raw.task);
    if (task === undefined) fail(`unknown task "${raw.task}"`);
    const { dependsOn } = raw;
    if (!Array.isArray(dependsOn) || dependsOn.length === 0 || !dependsOn.every((item) => typeof item === "string")) {
      fail('"dependsOn" must be a non-empty array of keys or refs');
      return;
    }

    const targets: Target[] = [];
    for (const item of dependsOn as string[]) {
      const target = resolve(item);
      if (target === undefined) fail(`unknown dependency "${item}"`);
      else if (task !== undefined && node(target) === node(task)) fail("depends on itself");
      else targets.push(target);
    }
    if (task === undefined) return;

    const from = node(task);
    const added = targets.filter((target) => {
      const key = edgeId(from, node(target));
      if (existing.has(key)) {
        if (!countedPresent.has(key)) alreadyPresentCount++;
        countedPresent.add(key);
        return false;
      }
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Same rule as imported done tasks: a done task can't wait on unfinished work.
    if (statusOf(task) === "done") {
      const pending = added.filter((target) => {
        const status = statusOf(target);
        return status !== undefined && isDependencyPending(status);
      });
      if (pending.length > 0) {
        fail(`is done but depends on tasks that are not done: ${pending.map((target) => target.item).join(", ")}`);
      }
    }
    for (const target of added) {
      const to = node(target);
      if (wouldCreateCycle(edges, from, to)) {
        fail(`depending on "${target.item}" closes a dependency cycle`);
        continue;
      }
      edges.push({ taskId: from, dependsOnTaskId: to });
      extraEdges.push({ task, dependsOn: target });
    }
  });
  return { extraEdges, alreadyPresentCount };
}

/** Reads `key` or `ref` (exactly one of them); reports problems through `fail`. */
function parseIdentity(
  raw: Record<string, unknown>,
  fail: (message: string, label?: string | null) => void,
): { id: string | null; key: string | undefined; ref: string | undefined } {
  const hasKey = raw.key !== undefined;
  const hasRef = raw.ref !== undefined;
  if (!hasKey && !hasRef) {
    fail('needs either "key" or "ref"');
    return { id: null, key: undefined, ref: undefined };
  }
  if (hasKey) {
    if (typeof raw.key !== "string") {
      fail('"key" must be a string');
      return { id: null, key: undefined, ref: undefined };
    }
    const key = raw.key.trim().toUpperCase();
    if (hasRef) {
      fail('has both "key" and "ref"', key);
      return { id: null, key: undefined, ref: undefined };
    }
    if (!EXPLICIT_KEY.test(key)) {
      fail('"key" must look like PREFIX-123 (1–10 letters or digits starting with a letter)', key);
      return { id: null, key: undefined, ref: undefined };
    }
    return { id: key, key, ref: undefined };
  }
  const ref = typeof raw.ref === "string" ? raw.ref.trim() : "";
  if (ref.length === 0 || ref.length > REF_MAX_LENGTH) {
    fail(`"ref" must be a non-empty string of at most ${REF_MAX_LENGTH} characters`);
    return { id: null, key: undefined, ref: undefined };
  }
  return { id: ref, key: undefined, ref };
}

/** Assigns keys: explicit ones as given, generated ones in file order after every existing and explicit key. */
function plan(
  project: TaskProjectRecord,
  existing: readonly TaskRecord[],
  { tasks, extraEdges, alreadyPresentCount }: ValidImport,
) {
  const explicitKeys = tasks.flatMap((task) => task.key ?? []);
  let next = nextTaskKeyNumber(
    project.taskKeyPrefix,
    project.nextTaskNumber,
    [...existing.map((task) => task.key), ...explicitKeys],
  );
  const keys = tasks.map((task) => task.key ?? formatTaskKey(project.taskKeyPrefix, next++));
  const keyOf = (target: Target) => (target.kind === "file" ? keys[target.index]! : target.task.key);
  const planned = tasks.map(
    (task, index): PlannedTask => ({
      key: keys[index]!,
      ref: task.ref ?? null,
      title: task.title,
      priority: task.priority,
      status: task.status,
      dependsOn: task.targets.map(keyOf),
    }),
  );
  const importPlan: ImportPlan = {
    projectSlug: project.slug,
    tasks: planned,
    explicitKeyCount: explicitKeys.length,
    dependencyCount: planned.reduce((sum, task) => sum + task.dependsOn.length, 0),
    roots: planned.filter((task) => task.dependsOn.length === 0).map((task) => task.key),
    addedDependencies: extraEdges.map((edge) => ({ task: keyOf(edge.task), dependsOn: keyOf(edge.dependsOn) })),
    alreadyPresentDependencyCount: alreadyPresentCount,
  };
  return { importPlan, nextTaskNumber: next };
}

/**
 * Imports a JSON file of tasks into a project, all or nothing: every task and
 * dependency is validated first (reporting every error), then everything is written in
 * one transaction with the project row locked, like task creation: the new tasks, their
 * dependencies, then the edges of the optional `dependencies` section (which may link
 * existing tasks; edges that already exist are skipped). Imported tasks are
 * unassigned, with the file's status (`todo` by default; a `done` task may only depend on
 * done tasks). After the commit, one summary notification goes out (never
 * one per task). With `dryRun`, it only returns the plan.
 */
export async function importTasks(
  { store, notifications }: ImportTasksDeps,
  slug: string,
  input: unknown,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<ImportTasksResult> {
  const events: NotificationEvent[] = [];
  const run = async (tx: TaskStore): Promise<ImportTasksResult> => {
    const normalized = normalizeProjectSlug(slug);
    const project = normalized === undefined ? undefined : await tx.findProjectBySlug(normalized, { lock: !dryRun });
    if (project === undefined) return { status: "project_not_found" };
    const existing = await tx.listProjectTasks(project.id);
    const validation = validate(input, existing, await tx.listProjectDependencies(project.id));
    if (!validation.ok) return { status: "invalid", errors: validation.errors };
    const { importPlan, nextTaskNumber } = plan(project, existing, validation);
    if (dryRun) return { status: "planned", plan: importPlan };

    const ids: number[] = [];
    for (const [index, task] of validation.tasks.entries()) {
      const { id } = await tx.insertTask({
        projectId: project.id,
        key: importPlan.tasks[index]!.key,
        title: task.title,
        description: task.description,
        priority: task.priority,
        stage: task.stage,
        status: task.status,
        assigneeId: null,
      });
      ids.push(id);
    }
    const idOf = (target: Target) => (target.kind === "file" ? ids[target.index]! : target.task.id);
    for (const [index, task] of validation.tasks.entries()) {
      for (const target of task.targets) await tx.addDependency(ids[index]!, idOf(target));
    }
    for (const edge of validation.extraEdges) await tx.addDependency(idOf(edge.task), idOf(edge.dependsOn));
    if (ids.length > 0) await tx.setNextTaskNumber(project.id, nextTaskNumber);

    const target = notificationTarget(project);
    // Only edges added: nothing worth announcing.
    if (target !== undefined && ids.length > 0) {
      events.push({
        ...target,
        type: "tasks_imported",
        count: importPlan.tasks.length,
        explicitKeyCount: importPlan.explicitKeyCount,
        doneCount: importPlan.tasks.filter((task) => task.status === "done").length,
      });
    }
    return { status: "imported", plan: importPlan };
  };

  if (dryRun) return run(store);
  const result = await store.transaction(run);
  notifications.publish(events);
  return result;
}
