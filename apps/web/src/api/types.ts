/** Response shapes of the server API (see the README "API" section). */

export const TASK_STATUSES = ["todo", "in_progress", "in_review", "done", "blocked"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Most to least urgent; the board sorts in this order. */
export const TASK_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type PullRequestState = "open" | "closed" | "merged";
export type Role = "admin" | "member";

export interface CurrentUser {
  id: number;
  githubLogin: string;
  name: string | null;
  avatarUrl: string | null;
  role: Role;
  /** The linked Discord account, if any. */
  discord: DiscordAccount | null;
  /** Whether the server is configured to link Discord accounts. */
  discordLinkingEnabled: boolean;
}

export interface DiscordAccount {
  id: string;
  /** Display name, else the Discord username. */
  username: string;
}

export interface Project {
  id: number;
  slug: string;
  name: string;
  taskKeyPrefix: string;
}

export interface TaskAssignee {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface BoardTask {
  key: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  stage: string | null;
  assignee: TaskAssignee | null;
  pullRequests: { number: number; state: PullRequestState; url: string }[];
  dependsOn: string[];
  pendingDependencies: string[];
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
  assignee: TaskAssignee | null;
  canTake: boolean;
  pendingDependencies: string[];
  dependsOn: TaskLink[];
  blocks: TaskLink[];
  pullRequests: TaskPullRequest[];
}

export interface NewTaskInput {
  title: string;
  description?: string;
  priority: TaskPriority;
  stage?: string;
  assigneeLogin?: string;
}

export interface TaskChanges {
  status?: TaskStatus;
  priority?: TaskPriority;
  /** Admins only; `null` unassigns. */
  assigneeLogin?: string | null;
}

/** Someone who can be assigned tasks in a project. */
export type Participant = TaskAssignee;

/** A GitHub login granted the member role (admin API). */
export interface AdminMember {
  githubLogin: string;
  /** ISO timestamp. */
  createdAt: string;
  /** Login of the admin who added them, when that user still exists. */
  addedBy: string | null;
}

export interface MembersOverview {
  /** Configured in the server (`ADMIN_GITHUB_LOGINS`); read-only. */
  admins: string[];
  members: AdminMember[];
}

export interface AdminProject {
  id: number;
  slug: string;
  name: string;
  taskKeyPrefix: string;
  discordChannelId: string | null;
  /** ISO timestamp. */
  createdAt: string;
}

export interface AdminProjectSummary extends AdminProject {
  repositoryCount: number;
  taskCount: number;
  memberCount: number;
}

export interface ProjectRepository {
  /** Lowercased `owner/repo`. */
  fullName: string;
  githubInstallationId: number | null;
}

export interface ProjectMember {
  githubLogin: string;
  /** ISO timestamp of when they joined the project. */
  createdAt: string;
}

export interface AdminProjectDetail extends AdminProject {
  repositories: ProjectRepository[];
  members: ProjectMember[];
}

export interface NewProjectInput {
  name: string;
  slug: string;
  taskKeyPrefix: string;
  discordChannelId: string | null;
}

export type ProjectChanges = Partial<NewProjectInput>;

export type ApiTokenStatus = "active" | "expired" | "revoked";

/** A project-scoped API token as listed to admins: metadata only, never the secret. */
export interface ApiToken {
  id: number;
  name: string;
  /** First 8 characters after `ttk_`. */
  prefix: string;
  permission: "read";
  /** ISO timestamps. */
  createdAt: string;
  /** Login of the admin who created it, when that user still exists. */
  createdBy: string | null;
  lastUsedAt: string | null;
  /** `null` when it never expires. */
  expiresAt: string | null;
  revokedAt: string | null;
  status: ApiTokenStatus;
}

/** The creation response: the only time the server returns the secret. */
export interface CreatedApiToken extends ApiToken {
  token: string;
}

export interface NewApiTokenInput {
  name: string;
  /** `null` means it never expires. */
  expiresInDays: number | null;
}
