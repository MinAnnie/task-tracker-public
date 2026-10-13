import { compareTaskKeys, extractTaskKeys, nextTaskStatus, type PrEvent, type TaskStatus } from "../domain/index.ts";
import {
  noNotifications,
  notificationTarget,
  type NotificationEvent,
  type NotificationPublisher,
} from "./notifications.ts";

/** A GitHub `pull_request` webhook delivery, reduced to what the use case needs. */
export interface PullRequestEventInput {
  /** Raw GitHub action, e.g. "opened", "closed", "synchronize". */
  action: string;
  repositoryFullName: string;
  installationId: number | null;
  pullRequest: {
    number: number;
    title: string;
    branch: string;
    url: string;
    authorLogin: string;
    state: "open" | "closed";
    merged: boolean;
    createdAt: Date;
    mergedAt: Date | null;
    closedAt: Date | null;
  };
}

export type PullRequestState = "open" | "closed" | "merged";

export interface RepositoryRecord {
  id: number;
  projectId: number;
  /** Lowercased slug of the repository's project. */
  projectSlug: string;
  /** Discord channel of the repository's project, if any. */
  discordChannelId: string | null;
  githubFullName: string;
  githubInstallationId: number | null;
}

export interface TaskRecord {
  id: number;
  key: string;
  status: TaskStatus;
}

/** A task linked to the pull request being processed. */
export interface LinkedTaskRecord extends TaskRecord {
  title: string;
  /** Whether some task it depends on is not done yet. */
  hasPendingDependencies: boolean;
}

export interface PullRequestUpsert {
  repositoryId: number;
  number: number;
  title: string;
  branch: string;
  url: string;
  authorGithubLogin: string;
  state: PullRequestState;
  openedAt: Date;
  mergedAt: Date | null;
  closedAt: Date | null;
}

/** Persistence port for pull request webhooks. Implemented by infrastructure adapters. */
export interface PullRequestWebhookStore {
  /** Runs `work` atomically; the callback receives a store bound to the transaction. */
  transaction<T>(work: (store: PullRequestWebhookStore) => Promise<T>): Promise<T>;
  /** Finds a repository by lowercased `owner/repo` (repositories are stored lowercased). */
  findRepositoryByFullName(fullName: string): Promise<RepositoryRecord | undefined>;
  setRepositoryInstallationId(repositoryId: number, installationId: number): Promise<void>;
  /** The stored state of the pull request identified by (repositoryId, number), if known. */
  findPullRequestState(repositoryId: number, number: number): Promise<PullRequestState | undefined>;
  /** Inserts or updates the pull request identified by (repositoryId, number). */
  upsertPullRequest(data: PullRequestUpsert): Promise<{ id: number }>;
  listProjectTasks(projectId: number): Promise<TaskRecord[]>;
  /** Links tasks to the pull request; existing links are left untouched. */
  linkTasks(pullRequestId: number, taskIds: readonly number[]): Promise<void>;
  listLinkedTasks(pullRequestId: number): Promise<LinkedTaskRecord[]>;
  updateTaskStatus(taskId: number, status: TaskStatus): Promise<void>;
  /**
   * Locks every task that depends on one of `taskIds`, then resolves those that are not
   * done and have no pending dependency left (see the task store's method of the same name).
   */
  findUnblockedDependents(taskIds: readonly number[]): Promise<UnblockedTaskRecord[]>;
}

/** A task that just lost its last pending dependency. */
export interface UnblockedTaskRecord {
  key: string;
  title: string;
  assigneeLogin: string | null;
}

export interface TaskStatusChange {
  taskKey: string;
  from: TaskStatus;
  to: TaskStatus;
}

export type PullRequestEventResult =
  | { status: "ignored"; reason: "unsupported_action" | "unknown_repository" }
  | {
      status: "processed";
      pullRequestId: number;
      /** Keys of every task linked to the pull request after this event. */
      linkedTaskKeys: string[];
      statusChanges: TaskStatusChange[];
    };

/** Actions that only refresh metadata and links, without moving task statuses. */
const RELINK_ACTIONS = new Set(["edited", "synchronize"]);

/**
 * Maps a GitHub pull request action to a domain event.
 * Returns `null` for actions that relink without a transition, `undefined` for unsupported ones.
 */
function toPrEvent(action: string, merged: boolean): PrEvent | null | undefined {
  switch (action) {
    case "opened":
      return "opened";
    case "reopened":
      return "reopened";
    case "closed":
      return merged ? "merged" : "closed_unmerged";
    default:
      return RELINK_ACTIONS.has(action) ? null : undefined;
  }
}

function toPullRequestState({ state, merged }: PullRequestEventInput["pullRequest"]): PullRequestState {
  if (merged) return "merged";
  return state;
}

/**
 * Applies a GitHub `pull_request` event: upserts the pull request, links tasks whose
 * keys appear in its title or branch, and moves linked tasks through their lifecycle.
 *
 * - Unsupported actions and unregistered repositories are ignored.
 * - Links are only ever added, never removed.
 * - Task statuses are persisted only when `nextTaskStatus` changes them, so
 *   redelivered events are idempotent.
 * - Tasks with pending dependencies get linked but keep their status: work on them
 *   must not start (or finish) before their dependencies are done.
 * - Once the transaction committed, projects with a channel are told about opened,
 *   reopened and merged pull requests with linked tasks (only when the stored state
 *   changes, so redeliveries stay silent) and about tasks a merge unblocked.
 */
export async function handlePullRequestEvent(
  store: PullRequestWebhookStore,
  input: PullRequestEventInput,
  notifications: NotificationPublisher = noNotifications,
): Promise<PullRequestEventResult> {
  const { pullRequest } = input;
  const prEvent = toPrEvent(input.action, pullRequest.merged);
  if (prEvent === undefined) return { status: "ignored", reason: "unsupported_action" };

  const events: NotificationEvent[] = [];
  const result = await store.transaction(async (tx): Promise<PullRequestEventResult> => {
    // GitHub reports the repository's display casing; links are stored lowercased.
    const repository = await tx.findRepositoryByFullName(input.repositoryFullName.toLowerCase());
    if (repository === undefined) return { status: "ignored", reason: "unknown_repository" };

    if (repository.githubInstallationId === null && input.installationId !== null) {
      await tx.setRepositoryInstallationId(repository.id, input.installationId);
    }

    const state = toPullRequestState(pullRequest);
    const previousState = await tx.findPullRequestState(repository.id, pullRequest.number);
    const { id: pullRequestId } = await tx.upsertPullRequest({
      repositoryId: repository.id,
      number: pullRequest.number,
      title: pullRequest.title,
      branch: pullRequest.branch,
      url: pullRequest.url,
      authorGithubLogin: pullRequest.authorLogin,
      state,
      openedAt: pullRequest.createdAt,
      mergedAt: pullRequest.mergedAt,
      closedAt: pullRequest.closedAt,
    });

    const projectTasks = await tx.listProjectTasks(repository.projectId);
    const keys = extractTaskKeys(
      `${pullRequest.title} ${pullRequest.branch}`,
      projectTasks.map((t) => t.key),
    );
    const matchedIds = projectTasks.filter((t) => keys.includes(t.key)).map((t) => t.id);
    if (matchedIds.length > 0) await tx.linkTasks(pullRequestId, matchedIds);

    const linkedTasks = await tx.listLinkedTasks(pullRequestId);
    const statusChanges: TaskStatusChange[] = [];
    if (prEvent !== null) {
      for (const task of linkedTasks) {
        if (task.hasPendingDependencies) continue;
        const next = nextTaskStatus(task.status, prEvent);
        if (next === task.status) continue;
        await tx.updateTaskStatus(task.id, next);
        statusChanges.push({ taskKey: task.key, from: task.status, to: next });
      }
    }

    const target = notificationTarget({ slug: repository.projectSlug, discordChannelId: repository.discordChannelId });
    if (target !== undefined) {
      const action = notifiedAction(prEvent);
      if (action !== undefined && state !== previousState && linkedTasks.length > 0) {
        events.push({
          ...target,
          type: "pull_request",
          action,
          pullRequest: {
            number: pullRequest.number,
            title: pullRequest.title,
            branch: pullRequest.branch,
            url: pullRequest.url,
            authorLogin: pullRequest.authorLogin,
          },
          taskKeys: linkedTasks.map((t) => t.key).sort(compareTaskKeys),
        });
      }
      const doneIds = linkedTasks
        .filter((t) => statusChanges.some((c) => c.taskKey === t.key && c.to === "done"))
        .map((t) => t.id);
      if (doneIds.length > 0) {
        const unblocked = await tx.findUnblockedDependents(doneIds);
        for (const task of [...unblocked].sort((a, b) => compareTaskKeys(a.key, b.key))) {
          events.push({
            ...target,
            type: "task_unblocked",
            task: { key: task.key, title: task.title },
            assigneeLogin: task.assigneeLogin,
          });
        }
      }
    }

    return {
      status: "processed",
      pullRequestId,
      linkedTaskKeys: linkedTasks.map((t) => t.key),
      statusChanges,
    };
  });
  notifications.publish(events);
  return result;
}

/** The pull request actions worth announcing. */
function notifiedAction(prEvent: PrEvent | null): "opened" | "reopened" | "merged" | undefined {
  return prEvent === "opened" || prEvent === "reopened" || prEvent === "merged" ? prEvent : undefined;
}
