import { isApiError } from "../api/client.ts";

const GENERIC = "Something went wrong. Try again.";
const RELOAD = "Something went wrong. Reload the page and try again.";

/** Human copy for the server's `error` codes. */
const MESSAGES: Record<string, string> = {
  network_error: "Can’t reach the server. Check your connection and try again.",
  unauthenticated: "Your session has ended. Sign in again.",
  forbidden: "You don’t have permission to do that.",
  project_not_found: "This project doesn’t exist or you no longer have access to it.",
  task_not_found: "There’s no task with that key in this project.",
  dependency_not_found: "That dependency was already removed.",
  invalid_assignee: "That person can’t be assigned tasks in this project.",
  empty_update: "There’s nothing to change.",
  self_dependency: "A task can’t depend on itself.",
  task_taken: "Someone else took this task first.",
  task_done: "This task is already done.",
  task_not_assigned: "This task isn’t assigned to anyone.",
  dependency_exists: "This task already depends on that one.",
  dependency_cycle: "That would create a circular dependency.",
  invalid_task_title: "Give the task a title of up to 200 characters.",
  invalid_task_description: "The description can be at most 10,000 characters.",
  invalid_task_stage: "The stage can be at most 50 characters.",
  invalid_task_priority: "Pick one of the listed priorities.",
  invalid_task_status: "Pick one of the listed statuses.",
  invalid_task_key: "Enter a task key, like ABC-7.",
  invalid_github_login: "That isn’t a valid GitHub username.",
  already_admin: "That person is an admin, so they already have access to everything.",
  already_member: "That person is already a member.",
  member_not_found: "That person isn’t a member. Add them under Members first.",
  invalid_project_name: "Give the project a name of up to 100 characters.",
  invalid_project_slug: "Use lowercase letters, numbers and single hyphens (up to 50).",
  invalid_task_key_prefix: "Use 1–10 letters or numbers, starting with a letter.",
  invalid_discord_channel_id: "A Discord channel ID is 17 to 20 digits.",
  slug_taken: "Another project already uses that short key.",
  prefix_taken: "Another project already uses that prefix.",
  prefix_locked: "The prefix can’t change once the project has tasks.",
  invalid_repository_name: "Enter a repository as owner/repo.",
  repository_taken: "A project already has that repository.",
  repository_not_found: "That repository was already removed.",
  already_project_member: "That person is already in this project.",
  project_member_not_found: "That person was already removed from this project.",
  invalid_token_name: "Give the token a name of up to 60 characters.",
  invalid_token_expiry: "Pick one of the listed expiry options.",
  token_not_found: "That token was already removed.",
  invalid_token_permission: RELOAD,
  invalid_origin: RELOAD,
  unsupported_media_type: RELOAD,
  malformed_json: RELOAD,
  invalid_body: RELOAD,
};

export function errorMessage(error: unknown): string {
  if (!isApiError(error)) return GENERIC;
  if (error.code === "dependencies_pending") {
    return error.pendingDependencies.length > 0
      ? `Finish its dependencies first: ${error.pendingDependencies.join(", ")}.`
      : "Finish its dependencies first.";
  }
  return MESSAGES[error.code] ?? GENERIC;
}
