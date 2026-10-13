/** URL builders for the app's routes. */
export const paths = {
  login: "/login",
  home: "/",
  admin: "/admin",
  adminMembers: "/admin/members",
  adminProjects: "/admin/projects",
  adminProject: (slug: string) => `/admin/projects/${encodeURIComponent(slug)}`,
  board: (slug: string) => `/projects/${encodeURIComponent(slug)}`,
  task: (slug: string, key: string) => `/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(key)}`,
  newTask: (slug: string) => `/projects/${encodeURIComponent(slug)}/tasks/new`,
};
