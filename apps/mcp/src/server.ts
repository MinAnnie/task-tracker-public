import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createToolHandlers, DEFAULT_LIST_LIMIT, DEFAULT_NEXT_LIMIT, MAX_LIST_LIMIT, type ToolDeps } from "./tools.ts";
import { TASK_PRIORITIES, TASK_STATUSES } from "./types.ts";

export const SERVER_NAME = "task-tracker";
export const SERVER_VERSION = "1.0.0";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const project = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Project slug (see list_projects). Optional: defaults to TRACKER_PROJECT, else the token's only project.",
  );

/** An MCP server exposing the Task Tracker read API as tools. */
export function createServer(deps: ToolDeps): McpServer {
  const tools = createToolHandlers(deps);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Read-only access to a Task Tracker project (tasks, priorities, dependencies, pull requests). " +
        "Use next_tasks to pick what to work on, list_tasks to browse or filter the board, " +
        "and get_task for the full brief of one task before implementing it.",
    },
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "List the Task Tracker projects visible to the configured API token (slug, name, task key prefix). " +
        "Tokens are project-scoped, so this is usually a single project. Use it to find the slug for other tools.",
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
      inputSchema: {
        key: z.string().min(1).describe("Task key such as 'RF-14' (case-insensitive)."),
        project,
      },
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

  return server;
}
