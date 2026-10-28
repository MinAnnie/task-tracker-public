/** Shapes of the Task Tracker API for tokens (see apps/server/src/openapi.ts). */

export const TASK_STATUSES = ["todo", "in_progress", "in_review", "done", "blocked"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Most to least urgent; the board sorts in this order. */
export const TASK_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type PullRequestState = "open" | "closed" | "merged";

export interface Project {
  id: number;
  slug: string;
  name: string;
  taskKeyPrefix: string;
}

export interface Participant {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface TaskListItem {
  key: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  stage: string | null;
  assignee: Participant | null;
  pullRequests: { number: number; state: PullRequestState; url: string }[];
  dependsOn: string[];
  pendingDependencies: string[];
  /** Always false for API tokens. */
  canTake: boolean;
}

export interface TaskLink {
  key: string;
  title: string;
  status: TaskStatus;
}

export interface TaskPullRequest {
  number: number;
  title: string;
  branch: string;
  url: string;
  state: PullRequestState;
  author: string;
}

export interface TaskDetail {
  key: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  stage: string | null;
  assignee: Participant | null;
  canTake: boolean;
  pendingDependencies: string[];
  dependsOn: TaskLink[];
  blocks: TaskLink[];
  pullRequests: TaskPullRequest[];
}

/** Body of POST /api/projects/{slug}/tasks (write tokens). */
export interface NewTaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  stage?: string;
  dependsOnKeys?: string[];
}

/** Body of PATCH /api/projects/{slug}/tasks/{key} (write tokens); `null` clears a field. */
export interface TaskChanges {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  stage?: string | null;
  status?: TaskStatus;
}
