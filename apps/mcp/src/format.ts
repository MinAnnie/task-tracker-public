import { compareTaskKeys, PRIORITY_LABELS, PULL_REQUEST_STATE_LABELS, STATUS_LABELS } from "./labels.ts";
import type { Project, TaskDetail, TaskListItem } from "./types.ts";

type ProjectRef = Pick<Project, "slug" | "name">;

const SLUG_MAX = 50;
const NONE = "—";

/**
 * A branch-friendly form of a title: lowercase ASCII words joined by `-`, accents
 * dropped, at most 50 characters (cut at a word boundary when possible).
 * Mirrors apps/web/src/features/task-detail/task-prompt.ts.
 */
export function branchSlug(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= SLUG_MAX) return slug;
  if (slug[SLUG_MAX] === "-") return slug.slice(0, SLUG_MAX);
  const head = slug.slice(0, SLUG_MAX);
  const boundary = head.lastIndexOf("-");
  return boundary > 0 ? head.slice(0, boundary) : head;
}

/** `feat/<KEY>-<slug>`: the server links pull requests from such a branch to the task. */
export function suggestedBranch(key: string, title: string): string {
  const slug = branchSlug(title);
  return slug ? `feat/${key}-${slug}` : `feat/${key}`;
}

/** Web route of a task (mirrors `paths.task` in apps/web/src/lib/paths.ts). */
export const taskUrl = (origin: string, slug: string, key: string) =>
  `${origin}/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(key)}`;

const sortedByKey = <T extends { key: string }>(items: readonly T[]) =>
  [...items].sort((a, b) => compareTaskKeys(a.key, b.key));

/** The markdown brief of a task for an AI coding agent (same structure as the web's "Copy for AI"). */
export function formatTaskPrompt(task: TaskDetail, project: ProjectRef, origin: string): string {
  const facts = [
    `Status: ${STATUS_LABELS[task.status]}`,
    `Priority: ${PRIORITY_LABELS[task.priority]}`,
    ...(task.stage ? [`Stage: ${task.stage}`] : []),
  ].join(" · ");
  const dependsOn = sortedByKey(task.dependsOn).map((d) => `${d.key} (${STATUS_LABELS[d.status]})`);
  const blocks = sortedByKey(task.blocks).map((b) => b.key);
  const pullRequests = task.pullRequests.map(
    (pr) => `#${pr.number} ${pr.title} (${PULL_REQUEST_STATE_LABELS[pr.state].toLowerCase()})`,
  );

  return [
    `# ${task.key} — ${task.title}`,
    "",
    `- Project: ${project.name}`,
    `- ${facts}`,
    `- Assignee: ${task.assignee ? `@${task.assignee.login}` : "Unassigned"}`,
    `- Depends on: ${dependsOn.length > 0 ? dependsOn.join(", ") : "None"}`,
    `- Blocks: ${blocks.length > 0 ? blocks.join(", ") : "Nothing"}`,
    ...(pullRequests.length > 0 ? [`- Linked pull requests: ${pullRequests.join(", ")}`] : []),
    `- Branch: ${suggestedBranch(task.key, task.title)}`,
    `- Link: ${taskUrl(origin, project.slug, task.key)}`,
    "",
    "## Description",
    "",
    task.description || "No description.",
  ].join("\n");
}

const header = (project: ProjectRef) => `${project.name} (${project.slug})`;

function taskLine(task: TaskListItem): string {
  const assignee = task.assignee ? `@${task.assignee.login}` : "unassigned";
  const line = [task.key, task.status, task.priority, task.stage ?? NONE, assignee, task.title].join(" · ");
  const waiting =
    task.pendingDependencies.length > 0 ? ` — waiting on ${task.pendingDependencies.join(", ")}` : "";
  return line + waiting;
}

/** Compact listing for `list_tasks`. */
export function formatTaskList({
  project,
  shown,
  matched,
  total,
}: {
  project: ProjectRef;
  shown: readonly TaskListItem[];
  matched: number;
  total: number;
}): string {
  if (shown.length === 0) return `${header(project)}: ${matched} of ${total} tasks match the filters.`;
  return [
    `${header(project)}: ${matched} of ${total} tasks match; showing ${shown.length}.`,
    "",
    "KEY · status · priority · stage · assignee · title",
    ...shown.map(taskLine),
  ].join("\n");
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

function readyReason(task: TaskListItem): string {
  const count = task.dependsOn.length;
  const dependencies =
    count === 0
      ? "no dependencies"
      : `its ${count} ${plural(count, "dependency is", "dependencies are")} done`;
  return `Ready: unassigned, status ${task.status}, ${dependencies}.`;
}

export interface NextTaskEntry {
  task: TaskListItem;
  /** Keys of the tasks that depend on it. */
  unblocks: readonly string[];
}

/** Output of `next_tasks`: ready tasks with why they are ready and what they unblock. */
export function formatNextTasks({
  project,
  entries,
  readyCount,
}: {
  project: ProjectRef;
  entries: readonly NextTaskEntry[];
  readyCount: number;
}): string {
  if (entries.length === 0) {
    return `${header(project)}: no task is ready (every open task is assigned or waiting on dependencies).`;
  }
  const lines = entries.flatMap(({ task, unblocks }, index) => [
    `${index + 1}. ${[task.key, task.priority, task.stage ?? NONE, task.title].join(" · ")}`,
    `   ${readyReason(task)} ${unblocks.length > 0 ? `Unblocks: ${unblocks.join(", ")}.` : "Unblocks nothing."}`,
  ]);
  return [
    `${header(project)}: ${readyCount} ready ${plural(readyCount, "task", "tasks")}; showing the top ${entries.length} by priority.`,
    "",
    ...lines,
    "",
    "Use get_task with a key for the full brief.",
  ].join("\n");
}

/** Output of `list_projects`. */
export function formatProjects(projects: readonly Project[]): string {
  if (projects.length === 0) return "No project is visible to this token.";
  return [
    `${projects.length} ${plural(projects.length, "project", "projects")} visible to this token:`,
    ...projects.map((p) => `- ${p.slug} · ${p.name} · keys ${p.taskKeyPrefix}-<n>`),
  ].join("\n");
}
