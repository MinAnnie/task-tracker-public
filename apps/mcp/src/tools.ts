import { TrackerApiError, type TrackerClient } from "./client.ts";
import type { Config } from "./config.ts";
import { formatNextTasks, formatProjects, formatTaskList, formatTaskPrompt } from "./format.ts";
import { compareTasks, dependentsOf, filterTasks, isReady, NO_TASK_FILTERS, type Availability } from "./task-filters.ts";
import type { Project, TaskPriority, TaskStatus } from "./types.ts";

export const MISSING_TOKEN_MESSAGE =
  "TRACKER_API_TOKEN is not set. Create a read-only API token in Task Tracker (Admin → project → API tokens), " +
  "export it as TRACKER_API_TOKEN in the environment that starts this MCP server, and restart it.";

export const MISSING_API_URL_MESSAGE =
  "TRACKER_API_URL is not set. Export it as the base URL of your Task Tracker (e.g. https://your-tracker.example.com) " +
  "in the environment that starts this MCP server, and restart it.";

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;
export const DEFAULT_NEXT_LIMIT = 10;

/** A tool's answer: text content, flagged `isError` when the call failed. */
export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface ListTasksArgs {
  project?: string;
  availability?: Availability;
  status?: TaskStatus[];
  priority?: TaskPriority[];
  stage?: string[];
  assignee?: string;
  search?: string;
  limit?: number;
}

export interface ToolDeps {
  /** `undefined` when the token or the API URL is not configured. */
  client: TrackerClient | undefined;
  config: Config;
}

/** A failure whose message is meant for the model as is. */
class ToolError extends Error {}

const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

export function createToolHandlers({ client, config }: ToolDeps) {
  async function run(work: (client: TrackerClient, apiUrl: string) => Promise<string>): Promise<ToolResult> {
    if (config.token === undefined) return fail(MISSING_TOKEN_MESSAGE);
    if (config.apiUrl === undefined) return fail(MISSING_API_URL_MESSAGE);
    if (client === undefined) return fail(MISSING_TOKEN_MESSAGE);
    try {
      return ok(await work(client, config.apiUrl));
    } catch (error) {
      if (error instanceof TrackerApiError || error instanceof ToolError) return fail(error.message);
      return fail(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The project to work on: the argument, else TRACKER_PROJECT, else the token's only project. */
  async function resolveProject(api: TrackerClient, requested: string | undefined): Promise<Project> {
    const projects = await api.listProjects();
    if (projects.length === 0) throw new ToolError("No project is visible to this token.");
    const slug = requested?.trim().toLowerCase() || config.project;
    if (slug === undefined) {
      if (projects.length === 1) return projects[0]!;
      const slugs = projects.map((p) => p.slug).join(", ");
      throw new ToolError(`Several projects are visible (${slugs}); pass "project" or set TRACKER_PROJECT.`);
    }
    const project = projects.find((p) => p.slug.toLowerCase() === slug);
    if (project === undefined) {
      const slugs = projects.map((p) => p.slug).join(", ");
      throw new ToolError(`Project "${slug}" is not visible to this token. Visible: ${slugs}.`);
    }
    return project;
  }

  return {
    listProjects: () => run(async (api) => formatProjects(await api.listProjects())),

    listTasks: (args: ListTasksArgs) =>
      run(async (api) => {
        const project = await resolveProject(api, args.project);
        const tasks = await api.listTasks(project.slug);
        const matched = filterTasks(tasks, {
          ...NO_TASK_FILTERS,
          availability: args.availability ?? "any",
          statuses: args.status ?? [],
          priorities: args.priority ?? [],
          stages: args.stage ?? [],
          assignee: args.assignee ?? "any",
          search: args.search ?? "",
        }).sort(compareTasks);
        const limit = Math.min(args.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
        return formatTaskList({ project, shown: matched.slice(0, limit), matched: matched.length, total: tasks.length });
      }),

    getTask: (args: { key: string; project?: string }) =>
      run(async (api, apiUrl) => {
        const project = await resolveProject(api, args.project);
        const task = await api.getTask(project.slug, args.key.trim());
        return formatTaskPrompt(task, project, apiUrl);
      }),

    nextTasks: (args: { project?: string; limit?: number }) =>
      run(async (api) => {
        const project = await resolveProject(api, args.project);
        const tasks = await api.listTasks(project.slug);
        const ready = tasks.filter(isReady).sort(compareTasks);
        const entries = ready
          .slice(0, args.limit ?? DEFAULT_NEXT_LIMIT)
          .map((task) => ({ task, unblocks: dependentsOf(tasks, task.key) }));
        return formatNextTasks({ project, entries, readyCount: ready.length });
      }),
  };
}

export type ToolHandlers = ReturnType<typeof createToolHandlers>;
