import type {
  AddTaskDependencyResult,
  CreateTaskResult,
  DeleteTaskResult,
  GetTaskResult,
  ListParticipantsResult,
  ListProjectStagesResult,
  ListTasksResult,
  ReleaseTaskResult,
  RemoveTaskDependencyResult,
  TakeTaskResult,
  TaskField,
  UpdateTaskResult,
} from "./application/tasks.ts";

/** Every unsuccessful outcome of a task use case. */
export type TaskFailure = Exclude<
  | ListTasksResult
  | ListParticipantsResult
  | ListProjectStagesResult
  | GetTaskResult
  | CreateTaskResult
  | TakeTaskResult
  | ReleaseTaskResult
  | UpdateTaskResult
  | AddTaskDependencyResult
  | RemoveTaskDependencyResult
  | DeleteTaskResult,
  { status: "ok" | "created" | "removed" | "deleted" }
>;

const INVALID_TASK_FIELD_ERRORS: Record<TaskField, string> = {
  body: "invalid_body",
  title: "invalid_task_title",
  description: "invalid_task_description",
  priority: "invalid_task_priority",
  stage: "invalid_task_stage",
  status: "invalid_task_status",
  dependsOnKey: "invalid_task_key",
  dependsOnKeys: "invalid_dependency",
};

const TASK_FAILURE_STATUS = {
  project_not_found: 404,
  task_not_found: 404,
  dependency_not_found: 404,
  forbidden: 403,
  invalid_assignee: 400,
  invalid_stage: 400,
  empty_update: 400,
  self_dependency: 400,
  task_taken: 409,
  task_done: 409,
  task_not_assigned: 409,
  dependency_exists: 409,
  dependency_cycle: 409,
} as const satisfies Record<
  Exclude<TaskFailure["status"], "invalid" | "dependencies_pending" | "invalid_dependency">,
  number
>;

/** The HTTP error a failed task use case answers: status and JSON body. */
export interface TaskFailureResponse {
  status: 400 | 403 | 404 | 409;
  body: { error: string; pendingDependencies?: readonly string[]; unknownKeys?: readonly string[] };
}

/**
 * Renders a failed task use case as its API error. The REST routes send it as is; the
 * MCP endpoint turns it into the same tool message the stdio server shows for it.
 */
export function taskFailureResponse(failure: TaskFailure): TaskFailureResponse {
  switch (failure.status) {
    case "invalid":
      return { status: 400, body: { error: INVALID_TASK_FIELD_ERRORS[failure.field] } };
    case "dependencies_pending":
      return { status: 409, body: { error: failure.status, pendingDependencies: failure.pendingDependencies } };
    case "invalid_dependency":
      return { status: 400, body: { error: failure.status, unknownKeys: failure.unknownKeys } };
    default:
      return { status: TASK_FAILURE_STATUS[failure.status], body: { error: failure.status } };
  }
}
