import type { TaskDependencyEdge, TaskPriority, TaskStatus } from "../domain/index.ts";
import type { PullRequestState } from "./handle-pull-request-event.ts";

/** The project fields task use cases need. */
export interface TaskProjectRecord {
  id: number;
  /** Lowercased slug. */
  slug: string;
  /** Uppercased prefix of the project's task keys (`RF` in `RF-14`). */
  taskKeyPrefix: string;
  /** Number the next created task key will use, before skipping past existing keys. */
  nextTaskNumber: number;
  /** Discord channel notifications go to; `null` when the project has none. */
  discordChannelId: string | null;
}

/** A user who signed in at least once (tasks can only be assigned to those). */
export interface TaskUserRecord {
  id: number;
  githubLogin: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface TaskRecord {
  id: number;
  key: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  stage: string | null;
  assignee: TaskUserRecord | null;
}

/** Another task of the same project, as referenced by a dependency. */
export interface TaskLinkRecord {
  id: number;
  key: string;
  title: string;
  status: TaskStatus;
}

/** A pull request linked to a task. */
export interface TaskPullRequestRecord {
  taskId: number;
  number: number;
  title: string;
  branch: string;
  url: string;
  state: PullRequestState;
  authorGithubLogin: string;
}

export interface NewTask {
  projectId: number;
  key: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  stage: string | null;
  assigneeId: number | null;
}

export interface TaskChanges {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  stage?: string | null;
  assigneeId?: number | null;
}

/** Persistence port for tasks and their dependencies. Implemented by infrastructure adapters. */
export interface TaskStore {
  /** Runs `work` atomically; the callback receives a store bound to the transaction. */
  transaction<T>(work: (store: TaskStore) => Promise<T>): Promise<T>;
  /**
   * Finds a project by lowercased slug. With `lock`, the row stays locked until the
   * surrounding transaction ends, serializing writers of the same project.
   */
  findProjectBySlug(slug: string, options?: { lock?: boolean }): Promise<TaskProjectRecord | undefined>;
  /** Whether the member with this lowercased login belongs to the project. */
  isProjectMember(projectId: number, githubLogin: string): Promise<boolean>;
  /** The user whose login matches `githubLogin` case-insensitively (the newest one if several do). */
  findUserByGithubLogin(githubLogin: string): Promise<TaskUserRecord | undefined>;
  /** The Discord user id linked to the user, or `null` when none is (or the user is unknown). */
  findDiscordUserId(userId: number): Promise<string | null>;
  /** Lowercased logins of the members of a project, in no particular order. */
  listProjectMemberLogins(projectId: number): Promise<string[]>;
  /**
   * Users whose login matches one of the lowercased `githubLogins` case-insensitively,
   * one per login (the newest one if several match), in no particular order.
   */
  findUsersByGithubLogins(githubLogins: readonly string[]): Promise<TaskUserRecord[]>;
  listProjectTaskKeys(projectId: number): Promise<string[]>;
  setNextTaskNumber(projectId: number, nextTaskNumber: number): Promise<void>;
  insertTask(task: NewTask): Promise<{ id: number }>;
  /** Every task of a project, in no particular order. */
  listProjectTasks(projectId: number): Promise<TaskRecord[]>;
  /** Every dependency edge between tasks of a project. */
  listProjectDependencies(projectId: number): Promise<TaskDependencyEdge[]>;
  /** Pull requests linked to the project's tasks, one entry per link, ordered by PR number. */
  listProjectPullRequests(projectId: number): Promise<TaskPullRequestRecord[]>;
  /**
   * Finds a task of the project by key, case-insensitively (an exact match wins).
   * With `lock`, the row stays locked until the surrounding transaction ends.
   */
  findTaskByKey(projectId: number, key: string, options?: { lock?: boolean }): Promise<TaskRecord | undefined>;
  /** Tasks this task depends on, in no particular order. */
  listDependencies(taskId: number): Promise<TaskLinkRecord[]>;
  /** Tasks that depend on this task, in no particular order. */
  listDependents(taskId: number): Promise<TaskLinkRecord[]>;
  /** Pull requests linked to the task, ordered by PR number. */
  listTaskPullRequests(taskId: number): Promise<TaskPullRequestRecord[]>;
  updateTask(taskId: number, changes: TaskChanges): Promise<void>;
  /**
   * Assigns the task to the user (moving `todo` to `in_progress`) only if, at write
   * time, it is unassigned, not done and has no pending dependency. Resolves whether
   * it did, so concurrent takes cannot both win.
   */
  takeTask(taskId: number, userId: number): Promise<boolean>;
  /** Adds the edge; resolves `false` without changes when it already exists. */
  addDependency(taskId: number, dependsOnTaskId: number): Promise<boolean>;
  /** Removes the edge; resolves whether it existed. */
  removeDependency(taskId: number, dependsOnTaskId: number): Promise<boolean>;
  /**
   * Locks (in id order, until the transaction ends) every task that depends on one of
   * `taskIds`, then re-reads them and resolves those that are not done and have no
   * pending dependency left. Locking first serializes concurrent changes that could
   * each unblock the same task, so exactly one of them sees it unblocked.
   */
  findUnblockedDependents(taskIds: readonly number[]): Promise<TaskRecord[]>;
  /**
   * Locks (in id order, until the transaction ends) every task that depends on this
   * task and resolves their ids. Lock them before a change that may unblock them.
   */
  lockDependents(taskId: number): Promise<number[]>;
  /**
   * Of the tasks with these ids, those that are not done and have no pending dependency
   * left, re-read by a fresh statement. Lock them first (see {@link lockDependents}).
   */
  findUnblockedTasks(taskIds: readonly number[]): Promise<TaskRecord[]>;
  /** Deletes the task; its dependency edges (both directions) and pull request links go with it. */
  deleteTask(taskId: number): Promise<void>;
}
