import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { API_TOKEN_PERMISSIONS } from "../domain/api-token.ts";
import { TASK_PRIORITIES } from "../domain/task-priority.ts";
import { TASK_STATUSES } from "../domain/task-status.ts";

export const taskStatusEnum = pgEnum("task_status", TASK_STATUSES);
export const taskPriorityEnum = pgEnum("task_priority", TASK_PRIORITIES);
export const pullRequestStateEnum = pgEnum("pull_request_state", ["open", "closed", "merged"]);
/** Only `read` for now; `write` can be added later with `ALTER TYPE ... ADD VALUE`. */
export const apiTokenPermissionEnum = pgEnum("api_token_permission", API_TOKEN_PERMISSIONS);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const projects = pgTable(
  "projects",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    /** Uppercased prefix of the project's task keys (`RF` in `RF-14`). */
    taskKeyPrefix: text("task_key_prefix").notNull().unique(),
    /** Number the next created task key will use. */
    nextTaskNumber: integer("next_task_number").notNull().default(1),
    discordChannelId: text("discord_channel_id"),
    createdAt: createdAt(),
  },
  (t) => [
    check("projects_task_key_prefix_format", sql`${t.taskKeyPrefix} ~ '^[A-Z][A-Z0-9]{0,9}$'`),
  ],
);

export const repositories = pgTable(
  "repositories",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    githubFullName: text("github_full_name").notNull().unique(),
    githubInstallationId: bigint("github_installation_id", { mode: "number" }),
  },
  (t) => [index("repositories_project_id_idx").on(t.projectId)],
);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
  githubLogin: text("github_login").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  discordUserId: text("discord_user_id").unique(),
  /** Display name of the linked Discord account, refreshed whenever it is linked. */
  discordUsername: text("discord_username"),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Hex SHA-256 of the opaque session token held in the browser cookie. */
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

/** GitHub logins granted the member role by an admin. Admins come from configuration only. */
export const members = pgTable(
  "members",
  {
    id: serial("id").primaryKey(),
    /** Always stored lowercased; GitHub logins are case-insensitive. */
    githubLogin: text("github_login").notNull().unique(),
    createdAt: createdAt(),
    addedByUserId: integer("added_by_user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [check("members_github_login_lowercase", sql`${t.githubLogin} = lower(${t.githubLogin})`)],
);

/** Members (never configured admins, who see every project) granted access to a project. */
export const projectMembers = pgTable(
  "project_members",
  {
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.memberId] }),
    index("project_members_member_id_idx").on(t.memberId),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    stage: text("stage"),
    status: taskStatusEnum("status").notNull().default("todo"),
    priority: taskPriorityEnum("priority").notNull().default("medium"),
    assigneeId: integer("assignee_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("tasks_project_id_key_unique").on(t.projectId, t.key),
    index("tasks_assignee_id_idx").on(t.assigneeId),
  ],
);

/** "`taskId` depends on `dependsOnTaskId`": the dependency must be done before the task starts. */
export const taskDependencies = pgTable(
  "task_dependencies",
  {
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnTaskId: integer("depends_on_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.dependsOnTaskId] }),
    index("task_dependencies_depends_on_task_id_idx").on(t.dependsOnTaskId),
    check("task_dependencies_not_self", sql`${t.taskId} <> ${t.dependsOnTaskId}`),
  ],
);

export const pullRequests = pgTable(
  "pull_requests",
  {
    id: serial("id").primaryKey(),
    repositoryId: integer("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    branch: text("branch").notNull(),
    url: text("url").notNull(),
    authorGithubLogin: text("author_github_login").notNull(),
    state: pullRequestStateEnum("state").notNull().default("open"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [unique("pull_requests_repository_id_number_unique").on(t.repositoryId, t.number)],
);

export const taskPullRequests = pgTable(
  "task_pull_requests",
  {
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    pullRequestId: integer("pull_request_id")
      .notNull()
      .references(() => pullRequests.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.pullRequestId] }),
    index("task_pull_requests_pull_request_id_idx").on(t.pullRequestId),
  ],
);

/** Project-scoped tokens for scripts and agents; only the hash of the secret is stored. */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Hex SHA-256 of the full `ttk_...` token. */
    tokenHash: text("token_hash").notNull().unique(),
    /** First 8 characters after `ttk_`, shown so admins can recognize a token. */
    tokenPrefix: text("token_prefix").notNull(),
    permission: apiTokenPermissionEnum("permission").notNull().default("read"),
    createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("api_tokens_project_id_idx").on(t.projectId)],
);
