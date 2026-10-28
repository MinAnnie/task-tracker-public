import { TASK_PRIORITIES, type TaskPriority } from "./task-priority.ts";
import { TASK_STATUSES, type TaskStatus } from "./task-status.ts";

const TASK_TITLE_MAX_LENGTH = 200;
const TASK_DESCRIPTION_MAX_LENGTH = 10_000;
const TASK_STAGE_MAX_LENGTH = 50;

/** Returns the trimmed title when it has 1–200 characters, `undefined` otherwise. */
export function normalizeTaskTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const title = value.trim();
  return title.length >= 1 && title.length <= TASK_TITLE_MAX_LENGTH ? title : undefined;
}

/**
 * Validates a description of at most 10000 characters, kept verbatim (it is free-form
 * text). `null` and blank strings mean "no description" and yield `null`; anything
 * else invalid yields `undefined`.
 */
export function normalizeTaskDescription(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > TASK_DESCRIPTION_MAX_LENGTH) return undefined;
  return value.trim().length === 0 ? null : value;
}

/**
 * Returns the trimmed stage when it has at most 50 characters. `null` and blank
 * strings mean "no stage" and yield `null`; anything else invalid yields `undefined`.
 */
export function normalizeTaskStage(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const stage = value.trim();
  if (stage.length > TASK_STAGE_MAX_LENGTH) return undefined;
  return stage.length === 0 ? null : stage;
}

/** Returns the trimmed name of a project stage when it has 1–50 characters, `undefined` otherwise. */
export function normalizeStageName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return name.length >= 1 && name.length <= TASK_STAGE_MAX_LENGTH ? name : undefined;
}

/** The stage named `name`, compared case-insensitively (stage names are unique that way). */
export function findStage<T extends { name: string }>(stages: readonly T[], name: string): T | undefined {
  const wanted = name.toLowerCase();
  return stages.find((stage) => stage.name.toLowerCase() === wanted);
}

export function normalizeTaskPriority(value: unknown): TaskPriority | undefined {
  return TASK_PRIORITIES.find((priority) => priority === value);
}

export function normalizeTaskStatus(value: unknown): TaskStatus | undefined {
  return TASK_STATUSES.find((status) => status === value);
}
