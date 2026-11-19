import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createTrackerMcpServer } from "@task-tracker/mcp";
import type { ApiTokenCaller } from "../application/api-tokens.ts";
import { createInProcessTrackerClient, type InProcessTrackerDeps } from "./in-process-tracker-client.ts";

export interface McpEndpointDeps extends InProcessTrackerDeps {
  /** Public origin of the app; task links in the tools' output point at it. */
  appBaseUrl: string;
}

/**
 * Answers `POST /mcp` with the same tools as the stdio server, run in-process as the
 * authenticated API token. Stateless Streamable HTTP: every request gets a fresh server
 * and transport (no session ids, nothing kept between requests) and a JSON response.
 */
export function createMcpRequestHandler({ appBaseUrl, ...deps }: McpEndpointDeps) {
  const config = { token: undefined, apiUrl: appBaseUrl.replace(/\/+$/, ""), project: undefined };

  return async (caller: ApiTokenCaller, request: Request, body: unknown): Promise<Response> => {
    const server = createTrackerMcpServer({ client: createInProcessTrackerClient(deps, caller), config });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      // With JSON responses this resolves once every request in the body has been answered.
      return await transport.handleRequest(request, { parsedBody: body });
    } finally {
      await server.close();
    }
  };
}
