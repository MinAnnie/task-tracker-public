import { and, asc, desc, eq, inArray, isNull, ne, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { TaskStore } from "../application/task-store.ts";
import type { TaskStatus } from "../domain/index.ts";
import * as schema from "../db/schema.ts";
import type { Executor } from "./drizzle-auth-store.ts";
import { findUnblockedDependents, findUnblockedTasks, lockDependents } from "./drizzle-unblocked-dependents.ts";

const { members, projectMembers, projects, pullRequests, taskDependencies, taskPullRequests, tasks, users } =
  schema;

/** The other end of a dependency edge, aliased to join it next to `task_dependencies`. */
const linked = alias(tasks, "linked");

const taskColumns = {
  id: tasks.id,
  key: tasks.key,
  title: tasks.title,
  description: tasks.description,
  status: tasks.status,
  priority: tasks.priority,
  stage: tasks.stage,
  assignee: {
    id: users.id,
    githubLogin: users.githubLogin,
    name: users.name,
    avatarUrl: users.avatarUrl,
  },
};

const linkColumns = { id: linked.id, key: linked.key, title: linked.title, status: linked.status };

const pullRequestColumns = {
  taskId: taskPullRequests.taskId,
  number: pullRequests.number,
  title: pullRequests.title,
  branch: pullRequests.branch,
  url: pullRequests.url,
  state: pullRequests.state,
  authorGithubLogin: pullRequests.authorGithubLogin,
};

/** Postgres adapter for {@link TaskStore} built on Drizzle. */
export function createDrizzleTaskStore(db: Executor): TaskStore {
  return {
    transaction: (work) => db.transaction((tx) => work(createDrizzleTaskStore(tx))),

    async findProjectBySlug(slug, { lock = false } = {}) {
      const query = db
        .select({
          id: projects.id,
          slug: projects.slug,
          taskKeyPrefix: projects.taskKeyPrefix,
          nextTaskNumber: projects.nextTaskNumber,
          discordChannelId: projects.discordChannelId,
        })
        .from(projects)
        .where(eq(projects.slug, slug))
        .limit(1);
      const [row] = lock ? await query.for("update") : await query;
      return row;
    },

    async isProjectMember(projectId, githubLogin) {
      const [row] = await db
        .select({ memberId: projectMembers.memberId })
        .from(projectMembers)
        .innerJoin(members, eq(members.id, projectMembers.memberId))
        .where(and(eq(projectMembers.projectId, projectId), eq(members.githubLogin, githubLogin)))
        .limit(1);
      return row !== undefined;
    },

    async findUserByGithubLogin(githubLogin) {
      const [row] = await db
        .select({ id: users.id, githubLogin: users.githubLogin, name: users.name, avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(sql`lower(${users.githubLogin})`, githubLogin.toLowerCase()))
        .orderBy(desc(users.id))
        .limit(1);
      return row;
    },

    async findDiscordUserId(userId) {
      const [row] = await db
        .select({ discordUserId: users.discordUserId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return row?.discordUserId ?? null;
    },

    async listProjectMemberLogins(projectId) {
      const rows = await db
        .select({ githubLogin: members.githubLogin })
        .from(projectMembers)
        .innerJoin(members, eq(members.id, projectMembers.memberId))
        .where(eq(projectMembers.projectId, projectId));
      return rows.map((row) => row.githubLogin);
    },

    async findUsersByGithubLogins(githubLogins) {
      if (githubLogins.length === 0) return [];
      const login = sql<string>`lower(${users.githubLogin})`;
      return db
        .selectDistinctOn([login], {
          id: users.id,
          githubLogin: users.githubLogin,
          name: users.name,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(inArray(login, githubLogins.map((l) => l.toLowerCase())))
        .orderBy(login, desc(users.id));
    },

    async listProjectTaskKeys(projectId) {
      const rows = await db.select({ key: tasks.key }).from(tasks).where(eq(tasks.projectId, projectId));
      return rows.map((row) => row.key);
    },

    async setNextTaskNumber(projectId, nextTaskNumber) {
      await db.update(projects).set({ nextTaskNumber }).where(eq(projects.id, projectId));
    },

    async insertTask(task) {
      const [row] = await db.insert(tasks).values(task).returning({ id: tasks.id });
      if (row === undefined) throw new Error("Task insert returned no row");
      return row;
    },

    listProjectTasks: (projectId) =>
      db
        .select(taskColumns)
        .from(tasks)
        .leftJoin(users, eq(users.id, tasks.assigneeId))
        .where(eq(tasks.projectId, projectId)),

    listProjectDependencies: (projectId) =>
      db
        .select({ taskId: taskDependencies.taskId, dependsOnTaskId: taskDependencies.dependsOnTaskId })
        .from(taskDependencies)
        .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
        .where(eq(tasks.projectId, projectId)),

    listProjectPullRequests: (projectId) =>
      db
        .select(pullRequestColumns)
        .from(taskPullRequests)
        .innerJoin(pullRequests, eq(pullRequests.id, taskPullRequests.pullRequestId))
        .innerJoin(tasks, eq(tasks.id, taskPullRequests.taskId))
        .where(eq(tasks.projectId, projectId))
        .orderBy(asc(pullRequests.number), asc(pullRequests.id)),

    async findTaskByKey(projectId, key, { lock = false } = {}) {
      const query = db
        .select(taskColumns)
        .from(tasks)
        .leftJoin(users, eq(users.id, tasks.assigneeId))
        .where(and(eq(tasks.projectId, projectId), eq(sql`lower(${tasks.key})`, key.toLowerCase())))
        // Keys are unique case-sensitively, so an exact match wins over case variants.
        .orderBy(desc(sql`${tasks.key} = ${key}`), asc(tasks.id))
        .limit(1);
      const [row] = lock ? await query.for("update", { of: tasks }) : await query;
      return row;
    },

    listDependencies: (taskId) =>
      db
        .select(linkColumns)
        .from(taskDependencies)
        .innerJoin(linked, eq(linked.id, taskDependencies.dependsOnTaskId))
        .where(eq(taskDependencies.taskId, taskId)),

    listDependents: (taskId) =>
      db
        .select(linkColumns)
        .from(taskDependencies)
        .innerJoin(linked, eq(linked.id, taskDependencies.taskId))
        .where(eq(taskDependencies.dependsOnTaskId, taskId)),

    listTaskPullRequests: (taskId) =>
      db
        .select(pullRequestColumns)
        .from(taskPullRequests)
        .innerJoin(pullRequests, eq(pullRequests.id, taskPullRequests.pullRequestId))
        .where(eq(taskPullRequests.taskId, taskId))
        .orderBy(asc(pullRequests.number), asc(pullRequests.id)),

    async updateTask(taskId, changes) {
      await db.update(tasks).set(changes).where(eq(tasks.id, taskId));
    },

    async takeTask(taskId, userId) {
      const pendingDependency = db
        .select({ one: sql`1` })
        .from(taskDependencies)
        .innerJoin(linked, eq(linked.id, taskDependencies.dependsOnTaskId))
        .where(and(eq(taskDependencies.taskId, taskId), ne(linked.status, "done")));
      // A concurrent take blocks on the row lock, then re-evaluates `assignee_id IS NULL`
      // against the committed row and updates nothing.
      const taken = await db
        .update(tasks)
        .set({
          assigneeId: userId,
          status: sql<TaskStatus>`case when ${tasks.status} = 'todo' then 'in_progress'::task_status else ${tasks.status} end`,
        })
        .where(
          and(
            eq(tasks.id, taskId),
            isNull(tasks.assigneeId),
            ne(tasks.status, "done"),
            notExists(pendingDependency),
          ),
        )
        .returning({ id: tasks.id });
      return taken.length > 0;
    },

    async addDependency(taskId, dependsOnTaskId) {
      const added = await db
        .insert(taskDependencies)
        .values({ taskId, dependsOnTaskId })
        .onConflictDoNothing({ target: [taskDependencies.taskId, taskDependencies.dependsOnTaskId] })
        .returning({ taskId: taskDependencies.taskId });
      return added.length > 0;
    },

    async removeDependency(taskId, dependsOnTaskId) {
      const removed = await db
        .delete(taskDependencies)
        .where(and(eq(taskDependencies.taskId, taskId), eq(taskDependencies.dependsOnTaskId, dependsOnTaskId)))
        .returning({ taskId: taskDependencies.taskId });
      return removed.length > 0;
    },

    findUnblockedDependents: (taskIds) => findUnblockedDependents(db, taskIds),

    lockDependents: (taskId) => lockDependents(db, taskId),

    findUnblockedTasks: (taskIds) => findUnblockedTasks(db, taskIds),

    async deleteTask(taskId) {
      // Dependency edges and pull request links cascade; the pull requests themselves stay.
      await db.delete(tasks).where(eq(tasks.id, taskId));
    },
  };
}
