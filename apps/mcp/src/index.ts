#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTrackerClient } from "./client.ts";
import { readConfig } from "./config.ts";
import { createServer } from "./server.ts";

// stdout carries the MCP protocol: log to stderr only, and never the token or request headers.
const log = (message: string) => process.stderr.write(`[task-tracker-mcp] ${message}\n`);

const config = readConfig(process.env);
const client =
  config.token === undefined || config.apiUrl === undefined
    ? undefined
    : createTrackerClient({ apiUrl: config.apiUrl, token: config.token });
const missing = [config.token === undefined && "TRACKER_API_TOKEN", config.apiUrl === undefined && "TRACKER_API_URL"].filter(
  Boolean,
);
const server = createServer({ client, config });

await server.connect(new StdioServerTransport());
log(
  `ready · API ${config.apiUrl ?? "(not set)"} · project ${config.project ?? "(token default)"} · ` +
    (missing.length > 0 ? `${missing.join(" and ")} not set: every tool will answer an error` : "token configured"),
);
