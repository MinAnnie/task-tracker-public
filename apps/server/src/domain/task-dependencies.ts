import type { TaskStatus } from "./task-status.ts";

/** "`taskId` depends on `dependsOnTaskId`": the latter must be done before the former can start. */
export interface TaskDependencyEdge {
  taskId: number;
  dependsOnTaskId: number;
}

/**
 * Whether adding the edge "`from` depends on `to`" would close a cycle, i.e. whether
 * `to` already depends on `from`, directly or transitively (or both are the same task).
 */
export function wouldCreateCycle(
  edges: readonly TaskDependencyEdge[],
  from: number,
  to: number,
): boolean {
  const dependsOn = new Map<number, number[]>();
  for (const { taskId, dependsOnTaskId } of edges) {
    const targets = dependsOn.get(taskId);
    if (targets === undefined) dependsOn.set(taskId, [dependsOnTaskId]);
    else targets.push(dependsOnTaskId);
  }

  const visited = new Set<number>();
  const pending = [to];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    if (current === from) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(dependsOn.get(current) ?? []));
  }
  return false;
}

/** A dependency stays pending (blocking its dependents) until it is done. */
export function isDependencyPending(status: TaskStatus): boolean {
  return status !== "done";
}

/** Keys of the dependencies that are still pending, in their given order. */
export function pendingDependencies(
  dependencies: readonly { key: string; status: TaskStatus }[],
): string[] {
  return dependencies.filter((d) => isDependencyPending(d.status)).map((d) => d.key);
}
