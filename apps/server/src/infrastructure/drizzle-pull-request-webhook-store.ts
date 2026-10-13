import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { alias, type PgDatabase } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type { PullRequestWebhookStore } from "../application/handle-pull-request-event.ts";
import * as schema from "../db/schema.ts";
import { findUnblockedDependents } from "./drizzle-unblocked-dependents.ts";

const { projects, pullRequests, repositories, taskDependencies, taskPullRequests, tasks } = schema;

/** The tasks a task depends on, aliased to join them next to the dependent task. */
const dependencies = alias(tasks, "dependencies");

/** A database handle or an open transaction; both expose the same query API. */
type Executor = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

/** Postgres adapter for {@link PullRequestWebhookStore} built on Drizzle. */
export function createDrizzlePullRequestWebhookStore(db: Executor): PullRequestWebhookStore {
  return {
    transaction: (work) =>
      db.transaction((tx) => work(createDrizzlePullRequestWebhookStore(tx))),

    async findRepositoryByFullName(fullName) {
      const [row] = await db
        .select({
          id: repositories.id,
          projectId: repositories.projectId,
          projectSlug: projects.slug,
          discordChannelId: projects.discordChannelId,
          githubFullName: repositories.githubFullName,
          githubInstallationId: repositories.githubInstallationId,
        })
        .from(repositories)
        .innerJoin(projects, eq(projects.id, repositories.projectId))
        .where(eq(repositories.githubFullName, fullName))
        .limit(1);
      return row;
    },

    async setRepositoryInstallationId(repositoryId, installationId) {
      await db
        .update(repositories)
        .set({ githubInstallationId: installationId })
        .where(and(eq(repositories.id, repositoryId), isNull(repositories.githubInstallationId)));
    },

    async findPullRequestState(repositoryId, number) {
      const [row] = await db
        .select({ state: pullRequests.state })
        .from(pullRequests)
        .where(and(eq(pullRequests.repositoryId, repositoryId), eq(pullRequests.number, number)))
        .limit(1);
      return row?.state;
    },

    async upsertPullRequest(data) {
      const { repositoryId: _, number: __, ...mutable } = data;
      const [row] = await db
        .insert(pullRequests)
        .values(data)
        .onConflictDoUpdate({
          target: [pullRequests.repositoryId, pullRequests.number],
          set: mutable,
        })
        .returning({ id: pullRequests.id });
      if (row === undefined) throw new Error("Pull request upsert returned no row");
      return row;
    },

    listProjectTasks: (projectId) =>
      db
        .select({ id: tasks.id, key: tasks.key, status: tasks.status })
        .from(tasks)
        .where(eq(tasks.projectId, projectId)),

    async linkTasks(pullRequestId, taskIds) {
      if (taskIds.length === 0) return;
      await db
        .insert(taskPullRequests)
        .values(taskIds.map((taskId) => ({ taskId, pullRequestId })))
        .onConflictDoNothing();
    },

    listLinkedTasks: (pullRequestId) =>
      db
        .select({
          id: tasks.id,
          key: tasks.key,
          title: tasks.title,
          status: tasks.status,
          hasPendingDependencies: sql<boolean>`exists (${db
            .select({ one: sql`1` })
            .from(taskDependencies)
            .innerJoin(dependencies, eq(dependencies.id, taskDependencies.dependsOnTaskId))
            .where(and(eq(taskDependencies.taskId, tasks.id), ne(dependencies.status, "done")))})`,
        })
        .from(taskPullRequests)
        .innerJoin(tasks, eq(tasks.id, taskPullRequests.taskId))
        .where(eq(taskPullRequests.pullRequestId, pullRequestId))
        .orderBy(tasks.id),

    async updateTaskStatus(taskId, status) {
      await db.update(tasks).set({ status }).where(eq(tasks.id, taskId));
    },

    async findUnblockedDependents(taskIds) {
      const unblocked = await findUnblockedDependents(db, taskIds);
      return unblocked.map(({ key, title, assignee }) => ({
        key,
        title,
        assigneeLogin: assignee?.githubLogin ?? null,
      }));
    },
  };
}
