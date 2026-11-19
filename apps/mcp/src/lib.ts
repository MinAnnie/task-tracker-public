/**
 * Library entry of the Task Tracker MCP server, for hosts other than the stdio binary
 * (the server's remote `/mcp` endpoint): the tool server factory and the client port it
 * runs on, with the error mapping that keeps every client's messages identical.
 */
export { createTrackerMcpServer, SERVER_NAME, SERVER_VERSION, TOOL_NAMES } from "./server.ts";
export {
  apiError,
  READ_ONLY_TOKEN_MESSAGE,
  TrackerApiError,
  type ApiErrorContext,
  type ApiFailure,
  type TrackerClient,
  type TrackerErrorKind,
} from "./client.ts";
export type { Config } from "./config.ts";
export type { ToolDeps } from "./tools.ts";
export type * from "./types.ts";
export { TASK_PRIORITIES, TASK_STATUSES } from "./types.ts";
