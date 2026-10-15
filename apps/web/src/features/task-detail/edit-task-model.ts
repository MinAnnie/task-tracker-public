import { isApiError } from "../../api/client.ts";
import type { BoardTask, TaskChanges, TaskDetail } from "../../api/types.ts";
import { errorMessage } from "../../lib/error-messages.ts";

// The server's limits (see the task fields in the server domain).
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 10_000;
const STAGE_MAX = 50;

export interface EditTaskValues {
  title: string;
  /** Blank means no description. */
  description: string;
  /** Blank means no stage. */
  stage: string;
}

export type EditTaskField = keyof EditTaskValues;
export type EditTaskErrors = Partial<Record<EditTaskField, string>>;

/** Form order, for focusing the first invalid field. */
export const EDIT_TASK_FIELDS: readonly EditTaskField[] = ["title", "description", "stage"];

export const editTaskValues = (task: Pick<TaskDetail, "title" | "description" | "stage">): EditTaskValues => ({
  title: task.title,
  description: task.description ?? "",
  stage: task.stage ?? "",
});

/** The server's checks: a title of 1–200 characters after trimming, at most 10,000 for the description, 50 for the stage. */
export function validateEditTask(values: EditTaskValues): EditTaskErrors {
  const errors: EditTaskErrors = {};
  const title = values.title.trim();
  if (title === "") errors.title = "Give the task a title.";
  else if (title.length > TITLE_MAX) errors.title = "Keep the title under 200 characters.";
  if (values.description.length > DESCRIPTION_MAX) {
    errors.description = "Keep the description under 10,000 characters.";
  }
  if (values.stage.trim().length > STAGE_MAX) errors.stage = "Keep the stage under 50 characters.";
  return errors;
}

/**
 * Only the fields that differ from the task, normalized like the server does: the title
 * and stage trimmed, the description kept verbatim, and blank ones as `null`.
 */
export function editTaskChanges(task: Pick<TaskDetail, "title" | "description" | "stage">, values: EditTaskValues) {
  const changes: TaskChanges = {};
  const title = values.title.trim();
  const description = values.description.trim() === "" ? null : values.description;
  const stage = values.stage.trim() === "" ? null : values.stage.trim();
  if (title !== task.title) changes.title = title;
  if (description !== task.description) changes.description = description;
  if (stage !== task.stage) changes.stage = stage;
  return changes;
}

/** A server refusal of the edit: its message and, when one field caused it, that field. */
export interface EditTaskFailure {
  message: string;
  field?: EditTaskField;
}

const FAILURE_FIELDS: Record<string, EditTaskField> = {
  invalid_task_title: "title",
  invalid_task_description: "description",
  invalid_task_stage: "stage",
};

export function editTaskFailure(error: unknown): EditTaskFailure {
  const field = isApiError(error) ? FAILURE_FIELDS[error.code] : undefined;
  return field ? { message: errorMessage(error), field } : { message: errorMessage(error) };
}

/** Client-side errors first; otherwise the server's, on the field that caused it. */
export function editTaskErrors(errors: EditTaskErrors, failure: EditTaskFailure | undefined): EditTaskErrors {
  if (failure?.field === undefined || errors[failure.field]) return errors;
  return { ...errors, [failure.field]: failure.message };
}

/** The stages already used on the board, sorted naturally ("Etapa 2" before "Etapa 10"). */
export function stageSuggestions(tasks: readonly BoardTask[]): string[] {
  const stages = new Set(tasks.flatMap((task) => (task.stage ? [task.stage] : [])));
  return [...stages].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}
