import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createToolHandlers, DEFAULT_LIST_LIMIT, DEFAULT_NEXT_LIMIT, MAX_LIST_LIMIT, type ToolDeps } from "./tools.ts";
import { TASK_PRIORITIES, TASK_STATUSES } from "./types.ts";

export const SERVER_NAME = "task-tracker";
export const SERVER_VERSION = "1.0.0";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
/** Writes that add data (a task, a dependency). */
const ADDITIVE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
/** Writes that change or remove existing data. */
const CHANGING = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } as const;

const WRITE_TOKEN_NOTE =
  "Needs a Read & write token; with a read-only token it fails with instructions to create one. " +
  "It acts as the user who created the token (a project token) or owns it (a personal token).";

const key = z.string().min(1).describe("Task key such as 'RF-14' (case-insensitive).");
const dependsOnKey = z.string().min(1).describe("Key of the task depended on, such as 'RF-13'.");

const project = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Project slug (see list_projects). Optional: defaults to TRACKER_PROJECT, else the token's only project. " +
      "Required when the token sees several projects (a personal token) and TRACKER_PROJECT is unset.",
  );

/** Every tool the server registers: four that read and four that modify data. */
export const TOOL_NAMES = [
  "list_projects",
  "list_tasks",
  "get_task",
  "next_tasks",
  "create_task",
  "update_task",
  "add_dependency",
  "remove_dependency",
] as const;

/**
 * The Task Tracker MCP server: the single definition of its tools (names, descriptions,
 * schemas, output). It talks to the tracker only through `deps.client`, so the stdio
 * entry (HTTP client) and the server's remote endpoint (in-process client) share it.
 * Create one per connection: an McpServer serves a single transport.
 */
export function createTrackerMcpServer(deps: ToolDeps): McpServer {
  const tools = createToolHandlers(deps);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Access to Task Tracker projects (tasks, priorities, dependencies, pull requests). " +
        "A project token sees one project; a personal token sees every project its owner can access, so pass " +
        "'project' (a slug from list_projects) unless TRACKER_PROJECT sets a default. " +
        "Use next_tasks to pick what to work on, list_tasks to browse or filter the board, " +
        "and get_task for the full brief of one task before implementing it. " +
        "create_task, update_task, add_dependency and remove_dependency modify data and need a Read & write token.",
    },
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "List the Task Tracker projects visible to the configured API token (slug, name, task key prefix). " +
        "A project token sees its one project; a personal token sees every project its owner can access. " +
        "Use it to find the slug for the 'project' argument of other tools.",
      annotations: READ_ONLY,
    },
    () => tools.listProjects(),
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "List and filter the tasks of a Task Tracker project, sorted like the board (priority urgent→low, then key). " +
        "One line per task: KEY · status · priority · stage · assignee · title, plus 'waiting on …' for pending " +
        "dependencies. Reports how many tasks match vs how many are shown. Filters combine with AND. " +
        "For a ready-to-work shortlist prefer next_tasks; for one task's details use get_task.",
      inputSchema: {
        project,
        availability: z
          .enum(["any", "ready", "blocked"])
          .optional()
          .describe(
            "'ready': unassigned, not done and with every dependency done (can be picked up now). " +
              "'blocked': has dependencies that are not done yet. Default 'any'.",
          ),
        status: z.array(z.enum(TASK_STATUSES)).optional().describe("Keep tasks with any of these statuses."),
        priority: z.array(z.enum(TASK_PRIORITIES)).optional().describe("Keep tasks with any of these priorities."),
        stage: z
          .array(z.string())
          .optional()
          .describe('Keep tasks in any of these stages (case-insensitive). Use "" for tasks without a stage.'),
        assignee: z
          .string()
          .optional()
          .describe("'any' (default), 'unassigned', or a GitHub login (case-insensitive, '@' optional)."),
        search: z.string().optional().describe("Case-insensitive text matched against the task key and title."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIST_LIMIT)
          .optional()
          .describe(`Maximum tasks to show (default ${DEFAULT_LIST_LIMIT}, max ${MAX_LIST_LIMIT}).`),
      },
      annotations: READ_ONLY,
    },
    (args) => tools.listTasks(args),
  );

  server.registerTool(
    "get_task",
    {
      title: "Get task brief",
      description:
        "Get one task as an AI-ready markdown brief: title, project, status/priority/stage, assignee, dependencies " +
        "with their statuses, tasks it blocks, linked pull requests, a suggested branch name (feat/<KEY>-<slug>, " +
        "which links PRs to the task), a link, and the full description verbatim. Use it before working on a task.",
      inputSchema: { key, project },
      annotations: READ_ONLY,
    },
    (args) => tools.getTask(args),
  );

  server.registerTool(
    "next_tasks",
    {
      title: "Next tasks to work on",
      description:
        "Suggest what to work on next: the ready tasks of a project (unassigned, not done, every dependency done), " +
        "most urgent first, each with a one-line reason why it is ready and which tasks it unblocks.",
      inputSchema: {
        project,
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIST_LIMIT)
          .optional()
          .describe(`Maximum tasks to suggest (default ${DEFAULT_NEXT_LIMIT}).`),
      },
      annotations: READ_ONLY,
    },
    (args) => tools.nextTasks(args),
  );

  server.registerTool(
    "create_task",
    {
      title: "Create task",
      description:
        "Modifies data: creates a task in a Task Tracker project and returns its brief (with its new key). " +
        "It starts unassigned in todo. Optionally depends on existing tasks of the project (dependsOn). " +
        WRITE_TOKEN_NOTE,
      inputSchema: {
        title: z.string().min(1).max(200).describe("1–200 characters."),
        description: z.string().max(10_000).optional().describe("Markdown, up to 10000 characters."),
        priority: z.enum(TASK_PRIORITIES).optional().describe("Default medium."),
        stage: z.string().optional().describe("One of the project's stages (case-insensitive); omit for none."),
        dependsOn: z
          .array(z.string().min(1))
          .max(50)
          .optional()
          .describe("Keys of existing tasks of the project the new task depends on."),
        project,
      },
      annotations: ADDITIVE,
    },
    (args) => tools.createTask(args),
  );

  server.registerTool(
    "update_task",
    {
      title: "Update task",
      description:
        "Modifies data: changes a task's title, description, priority, stage or status and returns its brief. " +
        "Pass only the fields to change; null clears the description or stage. Changing the status needs the token's " +
        "creator to be the assignee or an admin, and starting work needs every dependency done. The assignee " +
        "cannot be changed with a token. " +
        WRITE_TOKEN_NOTE,
      inputSchema: {
        key,
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(10_000).nullable().optional().describe("null clears it."),
        priority: z.enum(TASK_PRIORITIES).optional(),
        stage: z.string().nullable().optional().describe("One of the project's stages; null clears it."),
        status: z.enum(TASK_STATUSES).optional(),
        project,
      },
      annotations: CHANGING,
    },
    (args) => tools.updateTask(args),
  );

  server.registerTool(
    "add_dependency",
    {
      title: "Add dependency",
      description:
        "Modifies data: makes a task depend on another task of the same project (it can't be started until that " +
        "one is done). Refused when it would create a cycle. " +
        WRITE_TOKEN_NOTE,
      inputSchema: { key, dependsOn: dependsOnKey, project },
      annotations: ADDITIVE,
    },
    (args) => tools.addDependency(args),
  );

  server.registerTool(
    "remove_dependency",
    {
      title: "Remove dependency",
      description:
        "Modifies data: removes a dependency between two tasks of the same project. " + WRITE_TOKEN_NOTE,
      inputSchema: { key, dependsOn: dependsOnKey, project },
      annotations: CHANGING,
    },
    (args) => tools.removeDependency(args),
  );

  return server;
}
