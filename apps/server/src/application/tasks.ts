import {
  comparePriority,
  compareTaskKeys,
  formatTaskKey,
  isDiscordUserId,
  nextTaskKeyNumber,
  normalizeGithubLogin,
  normalizeProjectSlug,
  normalizeTaskDescription,
  normalizeTaskPriority,
  normalizeTaskStage,
  normalizeTaskStatus,
  normalizeTaskTitle,
  pendingDependencies,
  wouldCreateCycle,
  type TaskPriority,
  type TaskStatus,
} from "../domain/index.ts";
import type { PullRequestState } from "./handle-pull-request-event.ts";
import {
  notificationTarget,
  type AssigneeMention,
  type NotificationEvent,
  type NotificationPublisher,
  type NotificationTarget,
} from "./notifications.ts";
import type { AuthenticatedUser } from "./sessions.ts";
import type {
  TaskChanges,
  TaskLinkRecord,
  TaskProjectRecord,
  TaskPullRequestRecord,
  TaskRecord,
  TaskStore,
  TaskUserRecord,
} from "./task-store.ts";

export interface TasksDeps {
  store: TaskStore;
  /** Lowercased GitHub logins with the admin role (configuration, not stored). */
  adminLogins: readonly string[];
  /** Receives notification events once the transaction that caused them committed. */
  notifications: NotificationPublisher;
}

/** Request field that failed validation; `body` means the body is not a JSON object. */
export type TaskField = "body" | "title" | "description" | "priority" | "stage" | "status" | "dependsOnKey";

export interface TaskAssigneeView {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface TaskLinkView {
  key: string;
  title: string;
  status: TaskStatus;
}

/** A task as shown on the project board. */
export interface BoardTask {
  key: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  stage: string | null;
  assignee: TaskAssigneeView | null;
  pullRequests: { number: number; state: PullRequestState; url: string }[];
  /** Keys of the tasks this one depends on. */
  dependsOn: string[];
  /** Keys of the dependencies that are not done yet. */
  pendingDependencies: string[];
  /** Whether the caller may take the task right now. */
  canTake: boolean;
  /** ISO-8601 timestamps. */
  createdAt: string;
  updatedAt: string;
}

export interface TaskDetail {
  key: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  stage: string | null;
  assignee: TaskAssigneeView | null;
  canTake: boolean;
  pendingDependencies: string[];
  dependsOn: TaskLinkView[];
  /** Tasks that depend on this one. */
  blocks: TaskLinkView[];
  pullRequests: {
    number: number;
    title: string;
    branch: string;
    url: string;
    state: PullRequestState;
    author: string;
  }[];
  /** ISO-8601 timestamps. */
  createdAt: string;
  updatedAt: string;
}

/**
 * A read-only caller holding a project-scoped API token. It is not a user: it never
 * takes tasks and only sees its own project.
 */
export interface ApiTokenViewer {
  kind: "api_token";
  projectId: number;
}

/** Who reads a project: a signed-in user or an API token scoped to one project. */
export type TaskViewer = AuthenticatedUser | ApiTokenViewer;

const isApiTokenViewer = (viewer: TaskViewer): viewer is ApiTokenViewer =>
  "kind" in viewer && viewer.kind === "api_token";

type ProjectNotFound = { status: "project_not_found" };
type Forbidden = { status: "forbidden" };
type TaskNotFound = { status: "task_not_found" };
type Invalid = { status: "invalid"; field: TaskField };
type InvalidAssignee = { status: "invalid_assignee" };
type DependenciesPending = { status: "dependencies_pending"; pendingDependencies: readonly string[] };
type Found = { status: "ok"; task: TaskDetail };

export type ListParticipantsResult =
  | { status: "ok"; participants: TaskAssigneeView[] }
  | ProjectNotFound
  | Forbidden;
export type ListTasksResult = { status: "ok"; tasks: BoardTask[] } | ProjectNotFound | Forbidden;
export type GetTaskResult = Found | ProjectNotFound | Forbidden | TaskNotFound;
export type CreateTaskResult =
  | { status: "created"; task: TaskDetail }
  | ProjectNotFound
  | Forbidden
  | Invalid
  | InvalidAssignee;
export type TakeTaskResult =
  | Found
  | ProjectNotFound
  | Forbidden
  | TaskNotFound
  | { status: "task_taken" }
  | { status: "task_done" }
  | DependenciesPending;
export type ReleaseTaskResult =
  | Found
  | ProjectNotFound
  | Forbidden
  | TaskNotFound
  | { status: "task_not_assigned" };
export type UpdateTaskResult =
  | Found
  | ProjectNotFound
  | Forbidden
  | TaskNotFound
  | Invalid
  | { status: "empty_update" }
  | InvalidAssignee
  | DependenciesPending;
export type AddTaskDependencyResult =
  | { status: "created"; dependency: TaskLinkView }
  | ProjectNotFound
  | Forbidden
  | TaskNotFound
  | Invalid
  | { status: "self_dependency" }
  | { status: "dependency_exists" }
  | { status: "dependency_cycle" };
export type RemoveTaskDependencyResult =
  | { status: "removed" }
  | ProjectNotFound
  | Forbidden
  | TaskNotFound
  | { status: "dependency_not_found" };
export type DeleteTaskResult = { status: "deleted" } | ProjectNotFound | Forbidden | TaskNotFound;

/** Statuses that mean work on the task started; they require every dependency to be done. */
const STARTED_STATUSES: readonly TaskStatus[] = ["in_progress", "in_review", "done"];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toAssigneeView = (user: TaskUserRecord | null): TaskAssigneeView | null =>
  user && { login: user.githubLogin, name: user.name, avatarUrl: user.avatarUrl };

const toLinkView = ({ key, title, status }: TaskLinkRecord): TaskLinkView => ({ key, title, status });

const canTake = (task: TaskRecord, pending: readonly string[]) =>
  task.assignee === null && task.status !== "done" && pending.length === 0;

const isAdmin = (user: AuthenticatedUser) => user.role === "admin";

/**
 * Resolves a project the viewer participates in: configured admins see every project,
 * members only those they belong to, and API tokens only their own project (any
 * other is reported as not found, so tokens never learn which projects exist).
 * With `lock`, the project row stays locked for the rest of the transaction.
 */
async function openProject(
  store: TaskStore,
  user: TaskViewer,
  slug: string,
  lock = false,
): Promise<{ ok: true; project: TaskProjectRecord } | { ok: false; failure: ProjectNotFound | Forbidden }> {
  const normalized = normalizeProjectSlug(slug);
  const project = normalized === undefined ? undefined : await store.findProjectBySlug(normalized, { lock });
  if (project === undefined) return { ok: false, failure: { status: "project_not_found" } };
  if (isApiTokenViewer(user)) {
    return project.id === user.projectId
      ? { ok: true, project }
      : { ok: false, failure: { status: "project_not_found" } };
  }
  if (!isAdmin(user) && !(await store.isProjectMember(project.id, user.githubLogin.toLowerCase()))) {
    return { ok: false, failure: { status: "forbidden" } };
  }
  return { ok: true, project };
}

/**
 * Resolves an untrusted assignee login to a user who participates in the project
 * (a configured admin or a project member) and signed in at least once.
 */
async function resolveAssignee(
  { store, adminLogins }: { store: TaskStore; adminLogins: readonly string[] },
  projectId: number,
  githubLogin: unknown,
): Promise<TaskUserRecord | undefined> {
  const login = normalizeGithubLogin(githubLogin);
  if (login === undefined) return undefined;
  if (!adminLogins.includes(login) && !(await store.isProjectMember(projectId, login))) return undefined;
  return store.findUserByGithubLogin(login);
}

async function pendingDependenciesOf(store: TaskStore, taskId: number): Promise<string[]> {
  const dependencies = await store.listDependencies(taskId);
  return pendingDependencies([...dependencies].sort((a, b) => compareTaskKeys(a.key, b.key)));
}

/**
 * Describes a task; queries run one after another, since `store` may be a transaction.
 * `takeable` is false for viewers that can never take tasks (API tokens).
 */
async function describeTask(store: TaskStore, task: TaskRecord, takeable = true): Promise<TaskDetail> {
  const dependencies = await store.listDependencies(task.id);
  const dependents = await store.listDependents(task.id);
  const pullRequests = await store.listTaskPullRequests(task.id);
  const byKey = (a: TaskLinkRecord, b: TaskLinkRecord) => compareTaskKeys(a.key, b.key);
  const dependsOn = [...dependencies].sort(byKey);
  const pending = pendingDependencies(dependsOn);
  return {
    key: task.key,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    stage: task.stage,
    assignee: toAssigneeView(task.assignee),
    canTake: takeable && canTake(task, pending),
    pendingDependencies: pending,
    dependsOn: dependsOn.map(toLinkView),
    blocks: [...dependents].sort(byKey).map(toLinkView),
    pullRequests: [...pullRequests]
      .sort((a, b) => a.number - b.number)
      .map(({ number, title, branch, url, state, authorGithubLogin }) => ({
        number,
        title,
        branch,
        url,
        state,
        author: authorGithubLogin,
      })),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

/**
 * Runs `work` in a transaction, then publishes the events it collected. Publishing
 * happens only after the commit (never when the transaction throws) and never waits
 * for delivery.
 */
async function transactionThenNotify<T>(
  { store, notifications }: TasksDeps,
  work: (tx: TaskStore, events: NotificationEvent[]) => Promise<T>,
): Promise<T> {
  const events: NotificationEvent[] = [];
  const result = await store.transaction((tx) => work(tx, events));
  notifications.publish(events);
  return result;
}

const notificationTask = ({ key, title }: { key: string; title: string }) => ({ key, title });

/**
 * How to mention `assignee` in a notification: their linked Discord id, read in the
 * transaction building the event and dropped unless it is a snowflake, and whether to
 * ping them, which only happens when someone else (`actor`) gave them the task.
 */
async function assigneeMention(
  tx: TaskStore,
  assignee: TaskUserRecord,
  actor: AuthenticatedUser,
): Promise<AssigneeMention> {
  const stored = await tx.findDiscordUserId(assignee.id);
  const assigneeDiscordUserId = isDiscordUserId(stored) ? stored : null;
  return { assigneeDiscordUserId, ping: assigneeDiscordUserId !== null && assignee.id !== actor.id };
}

/**
 * `task_unblocked` events for the dependents of `taskIds` that are now free of pending
 * dependencies. Call it in the transaction, after `taskIds` became done.
 */
async function unblockedDependentEvents(
  tx: TaskStore,
  target: NotificationTarget | undefined,
  taskIds: readonly number[],
): Promise<NotificationEvent[]> {
  if (target === undefined || taskIds.length === 0) return [];
  return unblockedEvents(target, await tx.findUnblockedDependents(taskIds));
}

/** One `task_unblocked` event per task, in key order. */
function unblockedEvents(target: NotificationTarget, unblocked: readonly TaskRecord[]): NotificationEvent[] {
  return [...unblocked]
    .sort((a, b) => compareTaskKeys(a.key, b.key))
    .map((task) => ({
      ...target,
      type: "task_unblocked",
      task: notificationTask(task),
      assigneeLogin: task.assignee?.githubLogin ?? null,
    }));
}

/** Reloads a task after a write and describes it. */
async function reloadTask(store: TaskStore, projectId: number, key: string): Promise<TaskDetail> {
  const task = await store.findTaskByKey(projectId, key);
  if (task === undefined) throw new Error(`Task ${key} vanished after a write`);
  return describeTask(store, task);
}

/** The project board: every task, sorted by priority, then key number. */
export async function listTasks(
  { store }: TasksDeps,
  user: TaskViewer,
  slug: string,
): Promise<ListTasksResult> {
  const access = await openProject(store, user, slug);
  if (!access.ok) return access.failure;
  const { id } = access.project;
  const [tasks, edges, pullRequests] = await Promise.all([
    store.listProjectTasks(id),
    store.listProjectDependencies(id),
    store.listProjectPullRequests(id),
  ]);

  const byId = new Map(tasks.map((task) => [task.id, task]));
  const board = [...tasks]
    .sort((a, b) => comparePriority(a.priority, b.priority) || compareTaskKeys(a.key, b.key))
    .map((task): BoardTask => {
      const dependencies = edges
        .filter((edge) => edge.taskId === task.id)
        .flatMap((edge) => byId.get(edge.dependsOnTaskId) ?? [])
        .sort((a, b) => compareTaskKeys(a.key, b.key));
      const pending = pendingDependencies(dependencies);
      return {
        key: task.key,
        title: task.title,
        status: task.status,
        priority: task.priority,
        stage: task.stage,
        assignee: toAssigneeView(task.assignee),
        pullRequests: pullRequests
          .filter((pr: TaskPullRequestRecord) => pr.taskId === task.id)
          .sort((a, b) => a.number - b.number)
          .map(({ number, state, url }) => ({ number, state, url })),
        dependsOn: dependencies.map((d) => d.key),
        pendingDependencies: pending,
        canTake: !isApiTokenViewer(user) && canTake(task, pending),
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
      };
    });
  return { status: "ok", tasks: board };
}

/**
 * People who can be assigned tasks of the project: configured admins and project
 * members who signed in at least once, sorted by login.
 */
export async function listParticipants(
  { store, adminLogins }: TasksDeps,
  user: TaskViewer,
  slug: string,
): Promise<ListParticipantsResult> {
  const access = await openProject(store, user, slug);
  if (!access.ok) return access.failure;
  const memberLogins = await store.listProjectMemberLogins(access.project.id);
  const logins = [...new Set([...adminLogins, ...memberLogins])];
  const users = await store.findUsersByGithubLogins(logins);
  const participants = users
    .map(({ githubLogin, name, avatarUrl }) => ({ login: githubLogin, name, avatarUrl }))
    .sort((a, b) => a.login.toLowerCase().localeCompare(b.login.toLowerCase()));
  return { status: "ok", participants };
}

/** One task by key (case-insensitive) with its dependencies, dependents and pull requests. */
export async function getTask(
  { store }: TasksDeps,
  user: TaskViewer,
  slug: string,
  key: string,
): Promise<GetTaskResult> {
  const access = await openProject(store, user, slug);
  if (!access.ok) return access.failure;
  const task = await store.findTaskByKey(access.project.id, key);
  if (task === undefined) return { status: "task_not_found" };
  return { status: "ok", task: await describeTask(store, task, !isApiTokenViewer(user)) };
}

/**
 * Creates a task from an untrusted request body. Its key is `<prefix>-<n>`, numbered
 * while the project row is locked, so concurrent creations (and prefix changes)
 * serialize and generated keys never collide, even with imported ones.
 */
export async function createTask(
  deps: TasksDeps,
  user: AuthenticatedUser,
  slug: string,
  body: unknown,
): Promise<CreateTaskResult> {
  if (!isObject(body)) return { status: "invalid", field: "body" };
  const title = normalizeTaskTitle(body.title);
  if (title === undefined) return { status: "invalid", field: "title" };
  const description = body.description === undefined ? null : normalizeTaskDescription(body.description);
  if (description === undefined) return { status: "invalid", field: "description" };
  const priority = body.priority === undefined ? "medium" : normalizeTaskPriority(body.priority);
  if (priority === undefined) return { status: "invalid", field: "priority" };
  const stage = body.stage === undefined ? null : normalizeTaskStage(body.stage);
  if (stage === undefined) return { status: "invalid", field: "stage" };
  const assigneeLogin = body.assigneeLogin ?? null;
  const { adminLogins } = deps;

  return transactionThenNotify(deps, async (tx, events): Promise<CreateTaskResult> => {
    const access = await openProject(tx, user, slug, true);
    if (!access.ok) return access.failure;
    const { project } = access;

    let assignee: TaskUserRecord | null = null;
    if (assigneeLogin !== null) {
      const resolved = await resolveAssignee({ store: tx, adminLogins }, project.id, assigneeLogin);
      if (resolved === undefined) return { status: "invalid_assignee" };
      assignee = resolved;
    }

    const keys = await tx.listProjectTaskKeys(project.id);
    const taskNumber = nextTaskKeyNumber(project.taskKeyPrefix, project.nextTaskNumber, keys);
    const key = formatTaskKey(project.taskKeyPrefix, taskNumber);
    await tx.insertTask({
      projectId: project.id,
      key,
      title,
      description,
      priority,
      stage,
      status: assignee === null ? "todo" : "in_progress",
      assigneeId: assignee?.id ?? null,
    });
    await tx.setNextTaskNumber(project.id, taskNumber + 1);
    const target = notificationTarget(project);
    if (target !== undefined) {
      events.push({
        ...target,
        type: "task_created",
        task: { key, title },
        priority,
        actorLogin: user.githubLogin,
        ...(assignee === null
          ? { assigneeLogin: null, assigneeDiscordUserId: null, ping: false }
          : { assigneeLogin: assignee.githubLogin, ...(await assigneeMention(tx, assignee, user)) }),
      });
    }
    return { status: "created", task: await reloadTask(tx, project.id, key) };
  });
}

/** Why a task cannot be taken right now, or `undefined` when it can. */
async function takeRefusal(
  store: TaskStore,
  task: TaskRecord,
): Promise<{ status: "task_taken" } | { status: "task_done" } | DependenciesPending | undefined> {
  if (task.assignee !== null) return { status: "task_taken" };
  if (task.status === "done") return { status: "task_done" };
  const pending = await pendingDependenciesOf(store, task.id);
  if (pending.length > 0) return { status: "dependencies_pending", pendingDependencies: pending };
  return undefined;
}

/**
 * Assigns an unassigned, unfinished task without pending dependencies to the caller;
 * a `todo` task moves to `in_progress`. The write itself re-checks every condition,
 * so concurrent takes cannot both win.
 */
export async function takeTask(
  deps: TasksDeps,
  user: AuthenticatedUser,
  slug: string,
  key: string,
): Promise<TakeTaskResult> {
  return transactionThenNotify(deps, async (tx, events): Promise<TakeTaskResult> => {
    const access = await openProject(tx, user, slug);
    if (!access.ok) return access.failure;
    const { project } = access;
    const task = await tx.findTaskByKey(project.id, key, { lock: true });
    if (task === undefined) return { status: "task_not_found" };

    const refusal = await takeRefusal(tx, task);
    if (refusal !== undefined) return refusal;
    if (!(await tx.takeTask(task.id, user.id))) {
      const current = await tx.findTaskByKey(project.id, task.key);
      const lateRefusal = current && (await takeRefusal(tx, current));
      if (lateRefusal === undefined) throw new Error(`Taking task ${task.key} failed unexpectedly`);
      return lateRefusal;
    }
    const target = notificationTarget(project);
    if (target !== undefined) {
      events.push({
        ...target,
        type: "task_taken",
        task: notificationTask(task),
        assigneeLogin: user.githubLogin,
        ...(await assigneeMention(tx, user, user)),
        actorLogin: user.githubLogin,
      });
    }
    return { status: "ok", task: await reloadTask(tx, project.id, task.key) };
  });
}

/**
 * Unassigns a task; only its assignee or an admin may. An `in_progress` task goes
 * back to `todo`; other statuses stay.
 */
export async function releaseTask(
  { store }: TasksDeps,
  user: AuthenticatedUser,
  slug: string,
  key: string,
): Promise<ReleaseTaskResult> {
  return store.transaction(async (tx): Promise<ReleaseTaskResult> => {
    const access = await openProject(tx, user, slug);
    if (!access.ok) return access.failure;
    const { project } = access;
    const task = await tx.findTaskByKey(project.id, key, { lock: true });
    if (task === undefined) return { status: "task_not_found" };
    if (task.assignee === null) return { status: "task_not_assigned" };
    if (task.assignee.id !== user.id && !isAdmin(user)) return { status: "forbidden" };

    const changes: TaskChanges = { assigneeId: null };
    if (task.status === "in_progress") changes.status = "todo";
    await tx.updateTask(task.id, changes);
    return { status: "ok", task: await reloadTask(tx, project.id, task.key) };
  });
}

type ParsedUpdate = {
  changes: Omit<TaskChanges, "assigneeId">;
  /** Present when the body sets the assignee: a raw login to resolve, or `null` to unassign. */
  assigneeLogin?: unknown;
};

/** Validates the fields present in `body`, in a fixed order so errors are deterministic. */
function parseTaskUpdate(body: Record<string, unknown>): { ok: true; update: ParsedUpdate } | { ok: false; field: TaskField } {
  const changes: ParsedUpdate["changes"] = {};
  if ("title" in body) {
    const title = normalizeTaskTitle(body.title);
    if (title === undefined) return { ok: false, field: "title" };
    changes.title = title;
  }
  if ("description" in body) {
    const description = normalizeTaskDescription(body.description);
    if (description === undefined) return { ok: false, field: "description" };
    changes.description = description;
  }
  if ("stage" in body) {
    const stage = normalizeTaskStage(body.stage);
    if (stage === undefined) return { ok: false, field: "stage" };
    changes.stage = stage;
  }
  if ("priority" in body) {
    const priority = normalizeTaskPriority(body.priority);
    if (priority === undefined) return { ok: false, field: "priority" };
    changes.priority = priority;
  }
  if ("status" in body) {
    const status = normalizeTaskStatus(body.status);
    if (status === undefined) return { ok: false, field: "status" };
    changes.status = status;
  }
  const update: ParsedUpdate = { changes };
  if ("assigneeLogin" in body) update.assigneeLogin = body.assigneeLogin;
  return { ok: true, update };
}

/**
 * Partially updates a task from an untrusted request body.
 *
 * - title, description, stage, priority: any participant.
 * - status: the assignee or an admin; starting work (`in_progress`, `in_review`,
 *   `done`) requires every dependency to be done.
 * - assigneeLogin: admins only; the target must participate in the project, and
 *   assigning (not unassigning with `null`) requires every dependency to be done.
 *
 * Assigning someone new announces it; moving the task to `done` announces the
 * dependents it unblocked.
 */
export async function updateTask(
  deps: TasksDeps,
  user: AuthenticatedUser,
  slug: string,
  key: string,
  body: unknown,
): Promise<UpdateTaskResult> {
  if (!isObject(body)) return { status: "invalid", field: "body" };
  const parsed = parseTaskUpdate(body);
  if (!parsed.ok) return { status: "invalid", field: parsed.field };
  const { changes, assigneeLogin } = parsed.update;
  const setsAssignee = "assigneeLogin" in parsed.update;
  if (Object.keys(changes).length === 0 && !setsAssignee) return { status: "empty_update" };
  const { adminLogins } = deps;

  return transactionThenNotify(deps, async (tx, events): Promise<UpdateTaskResult> => {
    const access = await openProject(tx, user, slug);
    if (!access.ok) return access.failure;
    const { project } = access;
    const task = await tx.findTaskByKey(project.id, key, { lock: true });
    if (task === undefined) return { status: "task_not_found" };

    const isAssignee = task.assignee?.id === user.id;
    if (changes.status !== undefined && !isAssignee && !isAdmin(user)) return { status: "forbidden" };
    if (setsAssignee && !isAdmin(user)) return { status: "forbidden" };

    const write: TaskChanges = { ...changes };
    let newAssignee: TaskUserRecord | undefined;
    if (setsAssignee) {
      if (assigneeLogin === null) {
        write.assigneeId = null;
      } else {
        const assignee = await resolveAssignee({ store: tx, adminLogins }, project.id, assigneeLogin);
        if (assignee === undefined) return { status: "invalid_assignee" };
        write.assigneeId = assignee.id;
        if (assignee.id !== task.assignee?.id) newAssignee = assignee;
      }
    }

    const starts = changes.status !== undefined && STARTED_STATUSES.includes(changes.status);
    const assigns = write.assigneeId !== undefined && write.assigneeId !== null;
    if (starts || assigns) {
      const pending = await pendingDependenciesOf(tx, task.id);
      if (pending.length > 0) return { status: "dependencies_pending", pendingDependencies: pending };
    }

    await tx.updateTask(task.id, write);

    const target = notificationTarget(project);
    if (target !== undefined && newAssignee !== undefined) {
      events.push({
        ...target,
        type: "task_taken",
        task: notificationTask({ key: task.key, title: write.title ?? task.title }),
        assigneeLogin: newAssignee.githubLogin,
        ...(await assigneeMention(tx, newAssignee, user)),
        actorLogin: user.githubLogin,
      });
    }
    if (changes.status === "done" && task.status !== "done") {
      events.push(...(await unblockedDependentEvents(tx, target, [task.id])));
    }
    return { status: "ok", task: await reloadTask(tx, project.id, task.key) };
  });
}

/**
 * Makes the task depend on another task of the same project. The project row is
 * locked so concurrent additions cannot together close a cycle.
 */
export async function addTaskDependency(
  { store }: TasksDeps,
  user: AuthenticatedUser,
  slug: string,
  key: string,
  dependsOnKey: unknown,
): Promise<AddTaskDependencyResult> {
  if (typeof dependsOnKey !== "string") return { status: "invalid", field: "dependsOnKey" };

  return store.transaction(async (tx): Promise<AddTaskDependencyResult> => {
    const access = await openProject(tx, user, slug, true);
    if (!access.ok) return access.failure;
    const { project } = access;
    const task = await tx.findTaskByKey(project.id, key);
    const dependency = await tx.findTaskByKey(project.id, dependsOnKey);
    if (task === undefined || dependency === undefined) return { status: "task_not_found" };
    if (task.id === dependency.id) return { status: "self_dependency" };

    const edges = await tx.listProjectDependencies(project.id);
    if (edges.some((e) => e.taskId === task.id && e.dependsOnTaskId === dependency.id)) {
      return { status: "dependency_exists" };
    }
    if (wouldCreateCycle(edges, task.id, dependency.id)) return { status: "dependency_cycle" };
    if (!(await tx.addDependency(task.id, dependency.id))) return { status: "dependency_exists" };
    return { status: "created", dependency: toLinkView(dependency) };
  });
}

/**
 * Removes a dependency. When it was the task's last pending one (and the task is not
 * done), the task is announced as unblocked. The task row stays locked while pending
 * dependencies are counted before and after, so a concurrent change that also
 * unblocks it (a dependency getting done) is serialized with this one.
 */
export async function removeTaskDependency(
  deps: TasksDeps,
  user: AuthenticatedUser,
  slug: string,
  key: string,
  dependsOnKey: string,
): Promise<RemoveTaskDependencyResult> {
  return transactionThenNotify(deps, async (tx, events): Promise<RemoveTaskDependencyResult> => {
    const access = await openProject(tx, user, slug);
    if (!access.ok) return access.failure;
    const { project } = access;
    const task = await tx.findTaskByKey(project.id, key, { lock: true });
    const dependency = await tx.findTaskByKey(project.id, dependsOnKey);
    if (task === undefined || dependency === undefined) return { status: "task_not_found" };

    const target = notificationTarget(project);
    const watch = target !== undefined && task.status !== "done";
    const pendingBefore = watch ? await pendingDependenciesOf(tx, task.id) : [];
    if (!(await tx.removeDependency(task.id, dependency.id))) return { status: "dependency_not_found" };

    if (watch && pendingBefore.length > 0 && (await pendingDependenciesOf(tx, task.id)).length === 0) {
      events.push({
        ...target,
        type: "task_unblocked",
        task: notificationTask(task),
        assigneeLogin: task.assignee?.githubLogin ?? null,
      });
    }
    return { status: "removed" };
  });
}

/**
 * Deletes a task for good; admins only. Its dependency edges and pull request links go
 * with it, and its key is never reused (the project's next task number already moved
 * past it). The project row is locked so no dependency on the task can be added
 * meanwhile. When the task was not done, the tasks depending on it are locked before
 * the delete (like {@link removeTaskDependency}) and those left without pending
 * dependencies are announced as unblocked.
 */
export async function deleteTask(
  deps: TasksDeps,
  user: AuthenticatedUser,
  slug: string,
  key: string,
): Promise<DeleteTaskResult> {
  return transactionThenNotify(deps, async (tx, events): Promise<DeleteTaskResult> => {
    const access = await openProject(tx, user, slug, true);
    if (!access.ok) return access.failure;
    if (!isAdmin(user)) return { status: "forbidden" };
    const { project } = access;
    const task = await tx.findTaskByKey(project.id, key, { lock: true });
    if (task === undefined) return { status: "task_not_found" };

    const target = notificationTarget(project);
    // A done task blocks no one, so deleting it cannot unblock anything.
    const watch = target !== undefined && task.status !== "done";
    const dependentIds = watch ? await tx.lockDependents(task.id) : [];
    await tx.deleteTask(task.id);

    if (watch && dependentIds.length > 0) {
      events.push(...unblockedEvents(target, await tx.findUnblockedTasks(dependentIds)));
    }
    return { status: "deleted" };
  });
}
