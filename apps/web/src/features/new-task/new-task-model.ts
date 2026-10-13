import type { NewTaskInput, Participant, TaskPriority } from "../../api/types.ts";

const TITLE_MAX = 200;

export interface NewTaskValues {
  title: string;
  priority: TaskPriority;
  description: string;
  /** Login of the assignee; empty for unassigned. */
  assignee: string;
  stage: string;
}

export const EMPTY_VALUES: NewTaskValues = { title: "", priority: "medium", description: "", assignee: "", stage: "" };

export const PRIORITY_HINTS: Record<TaskPriority, string> = {
  urgent: "Urgent: drop what you’re doing. Shows first in every column.",
  high: "High: next up after urgent work.",
  medium: "Medium: the default for planned work.",
  low: "Low: nice to have, when there’s time.",
};

export function validateNewTask({ title }: Pick<NewTaskValues, "title">): { title?: string } {
  const trimmed = title.trim();
  if (trimmed === "") return { title: "Give the task a title." };
  if (trimmed.length > TITLE_MAX) return { title: "Keep the title under 200 characters." };
  return {};
}

/** The request body: trimmed, with blank optional fields left out. */
export function toNewTaskInput(values: NewTaskValues): NewTaskInput {
  const input: NewTaskInput = { title: values.title.trim(), priority: values.priority };
  if (values.description.trim() !== "") input.description = values.description;
  if (values.stage.trim() !== "") input.stage = values.stage.trim();
  if (values.assignee !== "") input.assigneeLogin = values.assignee;
  return input;
}

/**
 * The key the server will give the next task: one past the highest `<PREFIX>-<n>`.
 * Tasks are never deleted, so this matches the server unless someone creates a task meanwhile.
 */
export function nextTaskKey(prefix: string, keys: readonly string[]): string {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, "i");
  const highest = keys.reduce((max, key) => Math.max(max, Number(pattern.exec(key)?.[1] ?? 0)), 0);
  return `${prefix}-${highest + 1}`;
}

/**
 * Assignee choices after "Unassigned": the signed-in user first, then the project's
 * other participants in the server's order.
 */
export function assigneeOptions(myLogin: string, participants: readonly Participant[]) {
  const me = { login: myLogin, label: `Me (@${myLogin})` };
  const others = participants
    .filter((p) => p.login.toLowerCase() !== myLogin.toLowerCase())
    .map((p) => ({ login: p.login, label: p.name ? `${p.name} (@${p.login})` : `@${p.login}` }));
  return [me, ...others];
}
