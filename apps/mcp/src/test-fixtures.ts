import type { TaskDetail, TaskListItem } from "./types.ts";

/** Builders for tests. */
export const listItem = (overrides: Partial<TaskListItem> & { key: string }): TaskListItem => ({
  title: `Task ${overrides.key}`,
  status: "todo",
  priority: "medium",
  stage: null,
  assignee: null,
  pullRequests: [],
  dependsOn: [],
  pendingDependencies: [],
  canTake: false,
  ...overrides,
});

export const taskDetail = (overrides: Partial<TaskDetail> = {}): TaskDetail => ({
  key: "RF-14",
  title: "Add login with GitHub",
  description: "Use the OAuth app.\n\n- keep it simple",
  status: "todo",
  priority: "high",
  stage: null,
  assignee: null,
  canTake: false,
  pendingDependencies: [],
  dependsOn: [],
  blocks: [],
  pullRequests: [],
  ...overrides,
});
