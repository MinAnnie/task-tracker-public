import {
  apiError,
  type ApiErrorContext,
  type ApiFailure,
  type NewTaskInput,
  type Project,
  type TaskChanges,
  type TaskDetail,
  type TaskLink,
  type TaskListItem,
  type TrackerClient,
} from "@task-tracker/mcp";
import type { ApiTokenCaller } from "../application/api-tokens.ts";
import type { ProjectRef } from "../application/project-store.ts";
import type { AuthenticatedUser } from "../application/sessions.ts";
import type {
  AddTaskDependencyResult,
  CreateTaskResult,
  GetTaskResult,
  ListTasksResult,
  RemoveTaskDependencyResult,
  TaskViewer,
  UpdateTaskResult,
} from "../application/tasks.ts";
import { normalizeProjectSlug } from "../domain/index.ts";
import { taskFailureResponse, type TaskFailure } from "../task-failure.ts";

/** The use cases behind the MCP tools, bound to their stores (see index.ts). */
export interface InProcessTrackerDeps {
  listVisibleProjects: (user: AuthenticatedUser) => Promise<ProjectRef[]>;
  listTasks: (viewer: TaskViewer, slug: string) => Promise<ListTasksResult>;
  getTask: (viewer: TaskViewer, slug: string, key: string) => Promise<GetTaskResult>;
  createTask: (user: AuthenticatedUser, slug: string, body: unknown) => Promise<CreateTaskResult>;
  updateTask: (user: AuthenticatedUser, slug: string, key: string, body: unknown) => Promise<UpdateTaskResult>;
  addTaskDependency: (
    user: AuthenticatedUser,
    slug: string,
    key: string,
    dependsOnKey: unknown,
  ) => Promise<AddTaskDependencyResult>;
  removeTaskDependency: (
    user: AuthenticatedUser,
    slug: string,
    key: string,
    dependsOnKey: string,
  ) => Promise<RemoveTaskDependencyResult>;
  /** The user a project `write` token acts as (its creator with their current role), if any. */
  resolveApiTokenActor: (caller: ApiTokenCaller) => Promise<AuthenticatedUser | undefined>;
}

/**
 * What the REST API would have answered, as JSON: the tools then see exactly the data the
 * stdio server gets over HTTP (no `undefined` fields, dates as strings).
 */
const asJson = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;

const failed = (failure: TaskFailure, context: ApiErrorContext) => {
  const { status, body } = taskFailureResponse(failure);
  const { error: code, unknownKeys, pendingDependencies } = body;
  return apiError({ status, code, unknownKeys, pendingDependencies }, context);
};

/**
 * A {@link TrackerClient} that runs the use cases in this process as an authenticated API
 * token, with the same rules as the token-authenticated REST routes: a project token sees
 * only its project; writes need a `write` token (a personal one only while its owner is an
 * admin), act as the token's creator or owner, and never change the assignee. Failures
 * become the same errors the HTTP client raises for the equivalent API answer.
 */
export function createInProcessTrackerClient(deps: InProcessTrackerDeps, caller: ApiTokenCaller): TrackerClient {
  /** Mirrors the REST `requireTaskWriter` guard for bearer tokens. */
  async function writer(slug: string): Promise<AuthenticatedUser | ApiFailure> {
    if (caller.scope !== "write") return { status: 403, code: "token_not_allowed" };
    if (caller.projectId === null) {
      return caller.owner.role === "admin" ? caller.owner : { status: 403, code: "token_not_allowed" };
    }
    if (normalizeProjectSlug(slug) !== caller.project.slug) return { status: 404, code: "project_not_found" };
    return (await deps.resolveApiTokenActor(caller)) ?? { status: 403, code: "forbidden" };
  }

  async function actingUser(slug: string, context: ApiErrorContext): Promise<AuthenticatedUser> {
    const actor = await writer(slug);
    if ("status" in actor) throw apiError(actor, context);
    return actor;
  }

  return {
    async listProjects() {
      const projects = caller.projectId === null ? await deps.listVisibleProjects(caller.owner) : [caller.project];
      return asJson<Project[]>(projects);
    },

    async listTasks(slug) {
      const result = await deps.listTasks(caller, slug);
      if (result.status !== "ok") throw failed(result, { slug });
      return asJson<TaskListItem[]>(result.tasks);
    },

    async getTask(slug, key) {
      const result = await deps.getTask(caller, slug, key);
      if (result.status !== "ok") throw failed(result, { slug, key });
      return asJson<TaskDetail>(result.task);
    },

    async createTask(slug, input: NewTaskInput) {
      const context = { slug, write: true };
      const user = await actingUser(slug, context);
      const result = await deps.createTask(user, slug, asJson(input));
      if (result.status !== "created") throw failed(result, context);
      return asJson<TaskDetail>(result.task);
    },

    async updateTask(slug, key, changes: TaskChanges) {
      const context = { slug, key, write: true };
      const user = await actingUser(slug, context);
      const result = await deps.updateTask(user, slug, key, asJson(changes));
      if (result.status !== "ok") throw failed(result, context);
      return asJson<TaskDetail>(result.task);
    },

    async addDependency(slug, key, dependsOnKey) {
      const context = { slug, key, write: true };
      const user = await actingUser(slug, context);
      const result = await deps.addTaskDependency(user, slug, key, dependsOnKey);
      if (result.status !== "created") throw failed(result, context);
      return asJson<TaskLink>(result.dependency);
    },

    async removeDependency(slug, key, dependsOnKey) {
      const context = { slug, key, dependsOnKey, write: true };
      const user = await actingUser(slug, context);
      const result = await deps.removeTaskDependency(user, slug, key, dependsOnKey);
      if (result.status !== "removed") throw failed(result, context);
    },
  };
}
