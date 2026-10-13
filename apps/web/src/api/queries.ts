import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./endpoints.ts";
import type { NewApiTokenInput, NewProjectInput, NewTaskInput, ProjectChanges, TaskChanges } from "./types.ts";

export const queryKeys = {
  me: ["me"] as const,
  projects: ["projects"] as const,
  board: (slug: string) => ["projects", slug, "tasks"] as const,
  task: (slug: string, key: string) => ["projects", slug, "tasks", key.toUpperCase()] as const,
  participants: (slug: string) => ["projects", slug, "participants"] as const,
  /** Everything about one project the signed-in user sees: board, tasks, participants. */
  project: (slug: string) => ["projects", slug] as const,
  adminMembers: ["admin", "members"] as const,
  /** The admin project list; also the prefix of every project's admin detail. */
  adminProjects: ["admin", "projects"] as const,
  adminProject: (slug: string) => ["admin", "projects", slug] as const,
  adminProjectTokens: (slug: string) => ["admin", "projects", slug, "tokens"] as const,
};

export const useCurrentUser = () => useQuery({ queryKey: queryKeys.me, queryFn: api.fetchCurrentUser });

export const useProjects = () => useQuery({ queryKey: queryKeys.projects, queryFn: api.fetchProjects });

export const useBoard = (slug: string) =>
  useQuery({ queryKey: queryKeys.board(slug), queryFn: () => api.fetchBoard(slug) });

export const useTask = (slug: string, key: string) =>
  useQuery({ queryKey: queryKeys.task(slug, key), queryFn: () => api.fetchTask(slug, key) });

export const useParticipants = (slug: string, { enabled = true }: { enabled?: boolean } = {}) =>
  useQuery({ queryKey: queryKeys.participants(slug), queryFn: () => api.fetchParticipants(slug), enabled });

/**
 * Every task mutation can change the board (status, assignee, `canTake`) and other
 * tasks' details (`blocks`, dependency status), so it refreshes the whole project.
 */
function useProjectInvalidation(slug: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.board(slug) });
}

export function useTakeTask(slug: string) {
  const invalidate = useProjectInvalidation(slug);
  return useMutation({ mutationFn: (key: string) => api.takeTask(slug, key), onSettled: invalidate });
}

export function useReleaseTask(slug: string) {
  const invalidate = useProjectInvalidation(slug);
  return useMutation({ mutationFn: (key: string) => api.releaseTask(slug, key), onSettled: invalidate });
}

export function useUpdateTask(slug: string, key: string) {
  const invalidate = useProjectInvalidation(slug);
  return useMutation({
    mutationFn: (changes: TaskChanges) => api.updateTask(slug, key, changes),
    onSettled: invalidate,
  });
}

export function useAddDependency(slug: string, key: string) {
  const invalidate = useProjectInvalidation(slug);
  return useMutation({
    mutationFn: (dependsOnKey: string) => api.addDependency(slug, key, dependsOnKey),
    onSettled: invalidate,
  });
}

export function useRemoveDependency(slug: string, key: string) {
  const invalidate = useProjectInvalidation(slug);
  return useMutation({
    mutationFn: (dependsOnKey: string) => api.removeDependency(slug, key, dependsOnKey),
    onSettled: invalidate,
  });
}

/**
 * Admins only. Marks the board and every task of the project stale without refetching
 * now: the page is leaving the deleted task, whose refetch would only fail. Mounted
 * views (the board) refetch on their way in.
 */
export function useDeleteTask(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => api.deleteTask(slug, key),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.board(slug), refetchType: "none" }),
  });
}

export function useCreateTask(slug: string) {
  const invalidate = useProjectInvalidation(slug);
  return useMutation({ mutationFn: (input: NewTaskInput) => api.createTask(slug, input), onSettled: invalidate });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(queryKeys.me, null);
    },
  });
}

export function useDisconnectDiscord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.disconnectDiscord,
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.me }),
  });
}

// Admin

export const useAdminMembers = () => useQuery({ queryKey: queryKeys.adminMembers, queryFn: api.fetchMembers });

export const useAdminProjects = () =>
  useQuery({ queryKey: queryKeys.adminProjects, queryFn: api.fetchAdminProjects });

export const useAdminProject = (slug: string) =>
  useQuery({ queryKey: queryKeys.adminProject(slug), queryFn: () => api.fetchAdminProject(slug) });

/** Refreshes the given query prefixes once a mutation settles. */
function useInvalidate(...keys: readonly (readonly unknown[])[]) {
  const queryClient = useQueryClient();
  return () => Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

export function useAddMember() {
  const invalidate = useInvalidate(queryKeys.adminMembers);
  return useMutation({ mutationFn: api.addMember, onSettled: invalidate });
}

/** Removing a member drops their project memberships and unassigns their open tasks everywhere. */
export function useRemoveMember() {
  const invalidate = useInvalidate(queryKeys.adminMembers, queryKeys.adminProjects, queryKeys.projects);
  return useMutation({ mutationFn: api.removeMember, onSettled: invalidate });
}

/**
 * Project writes change the admin list and the header's project switcher. The
 * project's own detail is left alone: after a rename or deletion its old URL is gone.
 */
function useProjectListsInvalidation() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.adminProjects, exact: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projects, exact: true }),
    ]);
}

export function useCreateProject() {
  const invalidate = useProjectListsInvalidation();
  return useMutation({ mutationFn: (input: NewProjectInput) => api.createProject(input), onSettled: invalidate });
}

export function useUpdateProject(slug: string) {
  const queryClient = useQueryClient();
  const invalidateLists = useProjectListsInvalidation();
  return useMutation({
    mutationFn: (changes: ProjectChanges) => api.updateProject(slug, changes),
    onSuccess: (saved) =>
      Promise.all([invalidateLists(), queryClient.invalidateQueries({ queryKey: queryKeys.adminProject(saved.slug) })]),
  });
}

export function useDeleteProject(slug: string) {
  const queryClient = useQueryClient();
  const invalidateLists = useProjectListsInvalidation();
  return useMutation({
    mutationFn: () => api.deleteProject(slug),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.project(slug) });
      return invalidateLists();
    },
  });
}

export function useAddProjectRepository(slug: string) {
  const invalidate = useInvalidate(queryKeys.adminProjects);
  return useMutation({
    mutationFn: (fullName: string) => api.addProjectRepository(slug, fullName),
    onSettled: invalidate,
  });
}

export function useRemoveProjectRepository(slug: string) {
  const invalidate = useInvalidate(queryKeys.adminProjects);
  return useMutation({
    mutationFn: (fullName: string) => api.removeProjectRepository(slug, fullName),
    onSettled: invalidate,
  });
}

/** Membership changes who can be assigned and, on removal, unassigns tasks on the board. */
export function useAddProjectMember(slug: string) {
  const invalidate = useInvalidate(queryKeys.adminProjects, queryKeys.project(slug));
  return useMutation({
    mutationFn: (githubLogin: string) => api.addProjectMember(slug, githubLogin),
    onSettled: invalidate,
  });
}

export function useRemoveProjectMember(slug: string) {
  const invalidate = useInvalidate(queryKeys.adminProjects, queryKeys.project(slug));
  return useMutation({
    mutationFn: (githubLogin: string) => api.removeProjectMember(slug, githubLogin),
    onSettled: invalidate,
  });
}

export const useApiTokens = (slug: string) =>
  useQuery({ queryKey: queryKeys.adminProjectTokens(slug), queryFn: () => api.fetchApiTokens(slug) });

/**
 * The response carries the token's secret, so it must not linger in the mutation
 * cache: `gcTime: 0` drops the mutation as soon as the caller `reset()`s it (after
 * moving the secret into short-lived component state).
 */
export function useCreateApiToken(slug: string) {
  const invalidate = useInvalidate(queryKeys.adminProjectTokens(slug));
  return useMutation({
    mutationFn: (input: NewApiTokenInput) => api.createApiToken(slug, input),
    onSettled: invalidate,
    gcTime: 0,
  });
}

export function useRevokeApiToken(slug: string) {
  const invalidate = useInvalidate(queryKeys.adminProjectTokens(slug));
  return useMutation({ mutationFn: (id: number) => api.revokeApiToken(slug, id), onSettled: invalidate });
}
