import { normalizeGithubLogin } from "../domain/github-login.ts";
import {
  normalizeDiscordChannelId,
  normalizeProjectName,
  normalizeProjectSlug,
  normalizeRepositoryFullName,
  normalizeTaskKeyPrefix,
} from "../domain/project-fields.ts";
import type {
  NewProject,
  ProjectChanges,
  ProjectMemberRecord,
  ProjectRecord,
  ProjectRef,
  ProjectRepositoryRecord,
  ProjectStore,
  ProjectSummary,
  ProjectWriteResult,
} from "./project-store.ts";
import type { AuthenticatedUser } from "./sessions.ts";

export interface ProjectsDeps {
  store: ProjectStore;
  /** Lowercased GitHub logins with the admin role (configuration, not stored). */
  adminLogins: readonly string[];
}

/** Request field that failed validation; `body` means the body is not a JSON object. */
export type ProjectField = "body" | "name" | "slug" | "taskKeyPrefix" | "discordChannelId";

export interface ProjectDetail extends ProjectRecord {
  repositories: ProjectRepositoryRecord[];
  members: ProjectMemberRecord[];
}

type Invalid = { status: "invalid"; field: ProjectField };
type Taken = { status: "slug_taken" } | { status: "prefix_taken" };

export type CreateProjectResult = { status: "created"; project: ProjectRecord } | Invalid | Taken;
export type GetProjectResult = { status: "found"; project: ProjectDetail } | { status: "not_found" };
export type UpdateProjectResult =
  | { status: "updated"; project: ProjectRecord }
  | { status: "not_found" }
  | { status: "empty_update" }
  | { status: "prefix_locked" }
  | Invalid
  | Taken;
export type DeleteProjectResult = { status: "deleted" } | { status: "not_found" };
export type AddProjectRepositoryResult =
  | { status: "created"; repository: ProjectRepositoryRecord }
  | { status: "invalid_repository" }
  | { status: "project_not_found" }
  | { status: "repository_taken" };
export type RemoveProjectRepositoryResult =
  | { status: "removed" }
  | { status: "project_not_found" }
  | { status: "repository_not_found" };
export type AddProjectMemberResult =
  | { status: "created"; member: ProjectMemberRecord }
  | { status: "invalid_login" }
  | { status: "already_admin" }
  | { status: "project_not_found" }
  | { status: "member_not_found" }
  | { status: "already_project_member" };
export type RemoveProjectMemberResult =
  | { status: "removed" }
  | { status: "project_not_found" }
  | { status: "project_member_not_found" };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Validates the fields present in `body`, in a fixed order so errors are deterministic. */
function parseProjectFields(
  body: Record<string, unknown>,
): { ok: true; changes: ProjectChanges } | { ok: false; field: ProjectField } {
  const changes: ProjectChanges = {};
  if ("name" in body) {
    const name = normalizeProjectName(body.name);
    if (name === undefined) return { ok: false, field: "name" };
    changes.name = name;
  }
  if ("slug" in body) {
    const slug = normalizeProjectSlug(body.slug);
    if (slug === undefined) return { ok: false, field: "slug" };
    changes.slug = slug;
  }
  if ("taskKeyPrefix" in body) {
    const prefix = normalizeTaskKeyPrefix(body.taskKeyPrefix);
    if (prefix === undefined) return { ok: false, field: "taskKeyPrefix" };
    changes.taskKeyPrefix = prefix;
  }
  if ("discordChannelId" in body) {
    const channel = normalizeDiscordChannelId(body.discordChannelId);
    if (channel === undefined) return { ok: false, field: "discordChannelId" };
    changes.discordChannelId = channel;
  }
  return { ok: true, changes };
}

const REQUIRED_FIELDS = ["name", "slug", "taskKeyPrefix"] as const;

function toTaken(result: Extract<ProjectWriteResult, { status: "conflict" }>): Taken {
  return result.field === "slug" ? { status: "slug_taken" } : { status: "prefix_taken" };
}

async function findProject(store: ProjectStore, slug: string): Promise<ProjectRecord | undefined> {
  const normalized = normalizeProjectSlug(slug);
  return normalized === undefined ? undefined : store.findProjectBySlug(normalized);
}

export async function listProjects({ store }: ProjectsDeps): Promise<ProjectSummary[]> {
  return store.listProjects();
}

/** Admins see every project; members only the projects they belong to. */
export async function listVisibleProjects(
  { store }: ProjectsDeps,
  user: AuthenticatedUser,
): Promise<ProjectRef[]> {
  if (user.role === "admin") return store.listAllProjectRefs();
  return store.listProjectRefsForMember(user.githubLogin.toLowerCase());
}

/** Creates a project from an untrusted request body. */
export async function createProject(
  { store }: ProjectsDeps,
  body: unknown,
): Promise<CreateProjectResult> {
  if (!isObject(body)) return { status: "invalid", field: "body" };
  const parsed = parseProjectFields(body);
  if (!parsed.ok) return { status: "invalid", field: parsed.field };
  const missing = REQUIRED_FIELDS.find((field) => parsed.changes[field] === undefined);
  if (missing !== undefined) return { status: "invalid", field: missing };

  const project: NewProject = {
    name: parsed.changes.name!,
    slug: parsed.changes.slug!,
    taskKeyPrefix: parsed.changes.taskKeyPrefix!,
    discordChannelId: parsed.changes.discordChannelId ?? null,
  };
  const result = await store.createProject(project);
  return result.status === "saved" ? { status: "created", project: result.project } : toTaken(result);
}

export async function getProject({ store }: ProjectsDeps, slug: string): Promise<GetProjectResult> {
  const project = await findProject(store, slug);
  if (project === undefined) return { status: "not_found" };
  const [repositories, members] = await Promise.all([
    store.listProjectRepositories(project.id),
    store.listProjectMembers(project.id),
  ]);
  return { status: "found", project: { ...project, repositories, members } };
}

/**
 * Partially updates a project from an untrusted request body; `discordChannelId: null`
 * clears the channel. The task key prefix cannot change once the project has tasks,
 * because existing keys and the PR links built on them would break. The project row
 * is locked while checking, so a concurrent task creation cannot slip in between.
 */
export async function updateProject(
  { store }: ProjectsDeps,
  slug: string,
  body: unknown,
): Promise<UpdateProjectResult> {
  const normalizedSlug = normalizeProjectSlug(slug);
  if (normalizedSlug === undefined) return { status: "not_found" };
  if (!isObject(body)) return { status: "invalid", field: "body" };
  const parsed = parseProjectFields(body);
  if (!parsed.ok) return { status: "invalid", field: parsed.field };
  const { changes } = parsed;
  if (Object.keys(changes).length === 0) return { status: "empty_update" };

  return store.transaction(async (tx): Promise<UpdateProjectResult> => {
    const project = await tx.findProjectBySlug(normalizedSlug, { lock: true });
    if (project === undefined) return { status: "not_found" };
    const prefixChanges =
      changes.taskKeyPrefix !== undefined && changes.taskKeyPrefix !== project.taskKeyPrefix;
    if (prefixChanges && (await tx.countProjectTasks(project.id)) > 0) {
      return { status: "prefix_locked" };
    }
    const result = await tx.updateProject(project.id, changes);
    return result.status === "saved" ? { status: "updated", project: result.project } : toTaken(result);
  });
}

/** Deletes a project; its repositories, tasks and memberships go with it. */
export async function deleteProject({ store }: ProjectsDeps, slug: string): Promise<DeleteProjectResult> {
  const project = await findProject(store, slug);
  if (project === undefined) return { status: "not_found" };
  await store.deleteProject(project.id);
  return { status: "deleted" };
}

/** Links a GitHub repository (`fullName` is untrusted input) to a project. */
export async function addProjectRepository(
  { store }: ProjectsDeps,
  slug: string,
  fullName: unknown,
): Promise<AddProjectRepositoryResult> {
  const name = normalizeRepositoryFullName(fullName);
  if (name === undefined) return { status: "invalid_repository" };
  const project = await findProject(store, slug);
  if (project === undefined) return { status: "project_not_found" };

  const repository = await store.addRepository(project.id, name);
  return repository === undefined
    ? { status: "repository_taken" }
    : { status: "created", repository };
}

export async function removeProjectRepository(
  { store }: ProjectsDeps,
  slug: string,
  fullName: string,
): Promise<RemoveProjectRepositoryResult> {
  const project = await findProject(store, slug);
  if (project === undefined) return { status: "project_not_found" };
  const name = normalizeRepositoryFullName(fullName);
  if (name === undefined || !(await store.removeRepository(project.id, name))) {
    return { status: "repository_not_found" };
  }
  return { status: "removed" };
}

/**
 * Gives an app member (`githubLogin` is untrusted input) access to a project.
 * Configured admins already see every project and are never stored.
 */
export async function addProjectMember(
  { store, adminLogins }: ProjectsDeps,
  slug: string,
  githubLogin: unknown,
): Promise<AddProjectMemberResult> {
  const login = normalizeGithubLogin(githubLogin);
  if (login === undefined) return { status: "invalid_login" };
  if (adminLogins.includes(login)) return { status: "already_admin" };
  const project = await findProject(store, slug);
  if (project === undefined) return { status: "project_not_found" };
  const memberId = await store.findMemberIdByGithubLogin(login);
  if (memberId === undefined) return { status: "member_not_found" };

  const created = await store.addProjectMember(project.id, memberId);
  if (created === undefined) return { status: "already_project_member" };
  return { status: "created", member: { githubLogin: login, createdAt: created.createdAt } };
}

/**
 * Removes a member from a project and, in the same transaction, unassigns their
 * tasks in that project that are not done (`in_progress` ones go back to `todo`).
 * Configured admins keep their tasks
 * because they keep access to every project.
 */
export async function removeProjectMember(
  { store, adminLogins }: ProjectsDeps,
  slug: string,
  githubLogin: string,
): Promise<RemoveProjectMemberResult> {
  const project = await findProject(store, slug);
  if (project === undefined) return { status: "project_not_found" };
  const login = normalizeGithubLogin(githubLogin);
  if (login === undefined) return { status: "project_member_not_found" };

  const removed = await store.transaction(async (tx) => {
    if (!(await tx.removeProjectMember(project.id, login))) return false;
    if (!adminLogins.includes(login)) await tx.unassignOpenProjectTasks(project.id, login);
    return true;
  });
  return removed ? { status: "removed" } : { status: "project_member_not_found" };
}
