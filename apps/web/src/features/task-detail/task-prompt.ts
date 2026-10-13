import type { Project, TaskDetail } from "../../api/types.ts";
import { paths } from "../../lib/paths.ts";
import { compareTaskKeys, PRIORITY_LABELS, PULL_REQUEST_STATE_LABELS, STATUS_LABELS } from "../../lib/task-labels.ts";

const SLUG_MAX = 50;

/**
 * A branch-friendly form of a title: lowercase ASCII words joined by `-`, accents
 * dropped, at most 50 characters (cut at a word boundary when possible).
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

/**
 * `feat/<KEY>-<slug>`. The key keeps its case and is followed by `-`, so the server
 * links pull requests from this branch to the task.
 */
export function suggestedBranch(key: string, title: string): string {
  const slug = branchSlug(title);
  return slug ? `feat/${key}-${slug}` : `feat/${key}`;
}

const sortedByKey = <T extends { key: string }>(items: readonly T[]) =>
  [...items].sort((a, b) => compareTaskKeys(a.key, b.key));

/** A markdown brief of the task to paste into an AI coding agent. */
export function buildTaskPrompt(
  task: TaskDetail,
  project: Pick<Project, "slug" | "name">,
  origin: string,
): string {
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

  const lines = [
    `# ${task.key} — ${task.title}`,
    "",
    `- Project: ${project.name}`,
    `- ${facts}`,
    `- Assignee: ${task.assignee ? `@${task.assignee.login}` : "Unassigned"}`,
    `- Depends on: ${dependsOn.length > 0 ? dependsOn.join(", ") : "None"}`,
    `- Blocks: ${blocks.length > 0 ? blocks.join(", ") : "Nothing"}`,
    ...(pullRequests.length > 0 ? [`- Linked pull requests: ${pullRequests.join(", ")}`] : []),
    `- Branch: ${suggestedBranch(task.key, task.title)}`,
    `- Link: ${origin}${paths.task(project.slug, task.key)}`,
    "",
    "## Description",
    "",
    task.description || "No description.",
  ];
  return lines.join("\n");
}
