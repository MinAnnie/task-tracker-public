import { and, asc, eq, inArray, ne, notExists, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { TaskRecord } from "../application/task-store.ts";
import * as schema from "../db/schema.ts";
import type { Executor } from "./drizzle-auth-store.ts";

const { taskDependencies, tasks, users } = schema;

/** A dependency of the candidate task, aliased to join it next to `task_dependencies`. */
const dependency = alias(tasks, "dependency");

/**
 * Locks (in id order) every task depending on one of `taskIds`, then re-reads them and
 * returns those that are not done and have no pending dependency left. Must run in a
 * transaction, after the change that may have unblocked them.
 *
 * Why this is race-free under READ COMMITTED: every change that can unblock a task
 * (a dependency getting done, a dependency edge being removed, a dependency being
 * deleted) locks that task before counting its pending dependencies, and keeps the
 * lock until commit. Of two
 * concurrent changes, the one that locks first counts while the other is still
 * uncommitted (it cannot commit before taking the same lock), so it sees the task still
 * blocked; the second one counts after the first committed and sees it unblocked.
 * The count is a fresh statement after the lock, so it sees committed edge removals too.
 */
export async function findUnblockedDependents(db: Executor, taskIds: readonly number[]): Promise<TaskRecord[]> {
  if (taskIds.length === 0) return [];
  const dependentIds = db
    .select({ id: taskDependencies.taskId })
    .from(taskDependencies)
    .where(inArray(taskDependencies.dependsOnTaskId, [...taskIds]));

  const locked = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(inArray(tasks.id, dependentIds))
    .orderBy(asc(tasks.id))
    .for("update");
  if (locked.length === 0) return [];
  // Re-read the edges: one removed by a transaction that committed meanwhile no longer counts.
  return selectUnblocked(db, inArray(tasks.id, dependentIds));
}

/**
 * Locks (in id order) every task depending on `taskId` and resolves their ids. Lock
 * them before a change that may unblock them (deleting `taskId`), then pass the ids to
 * {@link findUnblockedTasks} once the change is done.
 */
export async function lockDependents(db: Executor, taskId: number): Promise<number[]> {
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      inArray(
        tasks.id,
        db
          .select({ id: taskDependencies.taskId })
          .from(taskDependencies)
          .where(eq(taskDependencies.dependsOnTaskId, taskId)),
      ),
    )
    .orderBy(asc(tasks.id))
    .for("update");
  return rows.map((row) => row.id);
}

/** Of `taskIds`, those not done and without pending dependencies, by a fresh statement. */
export async function findUnblockedTasks(db: Executor, taskIds: readonly number[]): Promise<TaskRecord[]> {
  if (taskIds.length === 0) return [];
  return selectUnblocked(db, inArray(tasks.id, [...taskIds]));
}

function selectUnblocked(db: Executor, candidates: SQL): Promise<TaskRecord[]> {
  const pendingDependency = db
    .select({ one: sql`1` })
    .from(taskDependencies)
    .innerJoin(dependency, eq(dependency.id, taskDependencies.dependsOnTaskId))
    .where(and(eq(taskDependencies.taskId, tasks.id), ne(dependency.status, "done")));

  return db
    .select({
      id: tasks.id,
      key: tasks.key,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      stage: tasks.stage,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      assignee: { id: users.id, githubLogin: users.githubLogin, name: users.name, avatarUrl: users.avatarUrl },
    })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(and(candidates, ne(tasks.status, "done"), notExists(pendingDependency)))
    .orderBy(asc(tasks.id));
}
