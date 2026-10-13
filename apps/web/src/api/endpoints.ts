import { ApiError, apiRequest } from "./client.ts";
import type {
  AdminMember,
  AdminProject,
  AdminProjectDetail,
  AdminProjectSummary,
  ApiToken,
  BoardTask,
  CreatedApiToken,
  CurrentUser,
  MembersOverview,
  NewApiTokenInput,
  NewProjectInput,
  NewTaskInput,
  Participant,
  Project,
  ProjectChanges,
  ProjectMember,
  ProjectRepository,
  TaskChanges,
  TaskDetail,
  TaskLink,
} from "./types.ts";

const tasksPath = (slug: string) => `/api/projects/${encodeURIComponent(slug)}/tasks`;
const taskPath = (slug: string, key: string) => `${tasksPath(slug)}/${encodeURIComponent(key)}`;
const adminProjectPath = (slug: string) => `/api/admin/projects/${encodeURIComponent(slug)}`;

/** The signed-in user, or `null` when there is no valid session. */
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  try {
    return await apiRequest<CurrentUser>("/auth/me");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export const logout = () => apiRequest<void>("/auth/logout", { method: "POST" });

/** Full-page navigation target: the server redirects to Discord and back to `/?discord=<outcome>`. */
export const CONNECT_DISCORD_URL = "/auth/discord";

export const disconnectDiscord = () => apiRequest<void>("/auth/discord", { method: "DELETE" });

export const fetchProjects = () => apiRequest<Project[]>("/api/projects");

export const fetchBoard = (slug: string) => apiRequest<BoardTask[]>(tasksPath(slug));

export const fetchTask = (slug: string, key: string) => apiRequest<TaskDetail>(taskPath(slug, key));

export const createTask = (slug: string, input: NewTaskInput) =>
  apiRequest<TaskDetail>(tasksPath(slug), { method: "POST", body: input });

export const updateTask = (slug: string, key: string, changes: TaskChanges) =>
  apiRequest<TaskDetail>(taskPath(slug, key), { method: "PATCH", body: changes });

export const takeTask = (slug: string, key: string) =>
  apiRequest<TaskDetail>(`${taskPath(slug, key)}/take`, { method: "POST" });

export const releaseTask = (slug: string, key: string) =>
  apiRequest<TaskDetail>(`${taskPath(slug, key)}/release`, { method: "POST" });

export const addDependency = (slug: string, key: string, dependsOnKey: string) =>
  apiRequest<TaskLink>(`${taskPath(slug, key)}/dependencies`, { method: "POST", body: { dependsOnKey } });

export const removeDependency = (slug: string, key: string, dependsOnKey: string) =>
  apiRequest<void>(`${taskPath(slug, key)}/dependencies/${encodeURIComponent(dependsOnKey)}`, {
    method: "DELETE",
  });

/** Admins only. */
export const deleteTask = (slug: string, key: string) => apiRequest<void>(taskPath(slug, key), { method: "DELETE" });

export const fetchParticipants = (slug: string) =>
  apiRequest<Participant[]>(`/api/projects/${encodeURIComponent(slug)}/participants`);

// Admin API

export const fetchMembers = () => apiRequest<MembersOverview>("/api/admin/members");

export const addMember = (githubLogin: string) =>
  apiRequest<AdminMember>("/api/admin/members", { method: "POST", body: { githubLogin } });

export const removeMember = (githubLogin: string) =>
  apiRequest<void>(`/api/admin/members/${encodeURIComponent(githubLogin)}`, { method: "DELETE" });

export const fetchAdminProjects = () => apiRequest<AdminProjectSummary[]>("/api/admin/projects");

export const createProject = (input: NewProjectInput) =>
  apiRequest<AdminProject>("/api/admin/projects", { method: "POST", body: input });

export const fetchAdminProject = (slug: string) => apiRequest<AdminProjectDetail>(adminProjectPath(slug));

export const updateProject = (slug: string, changes: ProjectChanges) =>
  apiRequest<AdminProject>(adminProjectPath(slug), { method: "PATCH", body: changes });

export const deleteProject = (slug: string) => apiRequest<void>(adminProjectPath(slug), { method: "DELETE" });

export const addProjectRepository = (slug: string, fullName: string) =>
  apiRequest<ProjectRepository>(`${adminProjectPath(slug)}/repositories`, { method: "POST", body: { fullName } });

/** `fullName` is `owner/repo`; each part is its own path segment. */
export const removeProjectRepository = (slug: string, fullName: string) =>
  apiRequest<void>(
    `${adminProjectPath(slug)}/repositories/${fullName.split("/").map(encodeURIComponent).join("/")}`,
    { method: "DELETE" },
  );

export const addProjectMember = (slug: string, githubLogin: string) =>
  apiRequest<ProjectMember>(`${adminProjectPath(slug)}/members`, { method: "POST", body: { githubLogin } });

export const removeProjectMember = (slug: string, githubLogin: string) =>
  apiRequest<void>(`${adminProjectPath(slug)}/members/${encodeURIComponent(githubLogin)}`, { method: "DELETE" });

export const fetchApiTokens = (slug: string) => apiRequest<ApiToken[]>(`${adminProjectPath(slug)}/tokens`);

export const createApiToken = (slug: string, input: NewApiTokenInput) =>
  apiRequest<CreatedApiToken>(`${adminProjectPath(slug)}/tokens`, { method: "POST", body: input });

export const revokeApiToken = (slug: string, id: number) =>
  apiRequest<void>(`${adminProjectPath(slug)}/tokens/${id}`, { method: "DELETE" });
