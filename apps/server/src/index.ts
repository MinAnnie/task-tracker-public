import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import {
  authenticateApiToken,
  createApiToken,
  createPersonalApiToken,
  listApiTokens,
  listPersonalApiTokens,
  resolveApiTokenActor,
  revokeApiToken,
  revokePersonalApiToken,
} from "./application/api-tokens.ts";
import { completeGithubLogin } from "./application/complete-github-login.ts";
import { resolveDiscordCaller } from "./application/discord-caller.ts";
import { completeDiscordBotInstall, listDiscordChannels, selectDiscordChannel } from "./application/discord-bot-install.ts";
import { backfillDiscordGuilds, syncDiscordCommands } from "./application/discord-guild-sync.ts";
import { completeDiscordLink, findDiscordAccount, unlinkDiscordAccount } from "./application/discord-link.ts";
import { handlePullRequestEvent } from "./application/handle-pull-request-event.ts";
import { addMember, listMembers, removeMember } from "./application/members.ts";
import {
  addProjectMember,
  addProjectRepository,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  listVisibleProjects,
  removeProjectMember,
  removeProjectRepository,
  updateProject,
} from "./application/projects.ts";
import { endSession, findSessionUser } from "./application/sessions.ts";
import { createStage, deleteStage, listStages, updateStage } from "./application/stages.ts";
import {
  addTaskDependency,
  createTask,
  deleteTask,
  getTask,
  listParticipants,
  listProjectStages,
  listTasks,
  releaseTask,
  removeTaskDependency,
  takeTask,
  updateTask,
} from "./application/tasks.ts";
import { loadConfig } from "./config.ts";
import { createDb } from "./db/client.ts";
import { runMigrations } from "./db/migrate.ts";
import { createNotificationPublisher } from "./infrastructure/create-notification-publisher.ts";
import { createDrizzleApiTokenStore } from "./infrastructure/drizzle-api-token-store.ts";
import { createInMemoryRateLimiter } from "./infrastructure/in-memory-rate-limiter.ts";
import { createDiscordBotHttpClient } from "./infrastructure/discord-bot-http-client.ts";
import { createDiscordGuildSyncHttpClient } from "./infrastructure/discord-guild-sync-http-client.ts";
import { createDiscordOAuthHttpClient } from "./infrastructure/discord-oauth-http-client.ts";
import { createDrizzleAuthStore } from "./infrastructure/drizzle-auth-store.ts";
import { createDrizzleProjectStore } from "./infrastructure/drizzle-project-store.ts";
import { createDrizzlePullRequestWebhookStore } from "./infrastructure/drizzle-pull-request-webhook-store.ts";
import { createDrizzleStageStore } from "./infrastructure/drizzle-stage-store.ts";
import { createDrizzleTaskStore } from "./infrastructure/drizzle-task-store.ts";
import { createGithubOAuthHttpClient } from "./infrastructure/github-oauth-http-client.ts";
import { createMcpRequestHandler } from "./mcp/mcp-endpoint.ts";
import { createDiscordInteractionHandler } from "./webhooks/discord/handle-interaction.ts";

const config = loadConfig();

console.log("Running database migrations...");
await runMigrations(config.databaseUrl);
console.log("Migrations applied.");

const { sql, db } = createDb(config.databaseUrl);
const pullRequestWebhookStore = createDrizzlePullRequestWebhookStore(db);
const authStore = createDrizzleAuthStore(db);
const adminLogins = config.adminGithubLogins;
const projectStore = createDrizzleProjectStore(db);
const projectsDeps = { store: projectStore, adminLogins };
// Use cases publish after their transaction commits; delivery runs in the background.
const notifications = createNotificationPublisher({
  discordBotToken: config.discordBotToken,
  appBaseUrl: config.appBaseUrl,
});
const apiTokensDeps = {
  store: createDrizzleApiTokenStore(db),
  adminLogins,
  isMember: (githubLogin: string) => authStore.isMember(githubLogin),
};
/** Per API token, in this process's memory. */
const apiTokenRateLimiter = createInMemoryRateLimiter({ limit: 120, windowMs: 60_000 });
const stagesDeps = { store: createDrizzleStageStore(db) };
const tasksDeps = { store: createDrizzleTaskStore(db), adminLogins, notifications };
const githubOAuthClient = createGithubOAuthHttpClient({
  clientId: config.githubClientId,
  clientSecret: config.githubClientSecret,
  redirectUri: new URL("/auth/github/callback", config.appBaseUrl).toString(),
});
const discordOAuthClient = config.discordOAuth
  ? createDiscordOAuthHttpClient({
      clientId: config.discordOAuth.applicationId,
      clientSecret: config.discordOAuth.clientSecret,
      redirectUri: new URL("/auth/discord/callback", config.appBaseUrl).toString(),
    })
  : undefined;
console.log(`Discord account linking ${discordOAuthClient ? "enabled" : "disabled"}.`);
// Connect Discord (bot install from the project settings) needs the OAuth app and the bot.
const discordBotClient =
  config.discordOAuth && config.discordBotToken
    ? createDiscordBotHttpClient({
        applicationId: config.discordOAuth.applicationId,
        clientSecret: config.discordOAuth.clientSecret,
        botToken: config.discordBotToken,
        redirectUri: new URL("/auth/discord/callback", config.appBaseUrl).toString(),
      })
    : undefined;
console.log(`Connect Discord (bot install) ${discordBotClient ? "enabled" : "disabled"}.`);
/** Deps of the Connect Discord use cases; the app only routes to them when they are enabled. */
const discordBotDeps = () => {
  if (discordBotClient === undefined) throw new Error("Connect Discord is disabled");
  return { store: projectStore, discord: discordBotClient };
};
// Slash commands run the same task use cases as the web, so the rules are identical.
const handleDiscordInteraction = createDiscordInteractionHandler({
  appBaseUrl: config.appBaseUrl,
  resolveCaller: (discordUserId, channelId) =>
    resolveDiscordCaller({ auth: authStore, projects: projectStore, adminLogins }, discordUserId, channelId),
  listTasks: (user, slug) => listTasks(tasksDeps, user, slug),
  getTask: (user, slug, key) => getTask(tasksDeps, user, slug, key),
  takeTask: (user, slug, key) => takeTask(tasksDeps, user, slug, key),
  releaseTask: (user, slug, key) => releaseTask(tasksDeps, user, slug, key),
});
console.log(`Discord slash commands ${config.discordPublicKey ? "enabled" : "disabled"}.`);
// The remote MCP endpoint runs the stdio server's tools in-process, as the request's API token.
const handleMcpRequest = createMcpRequestHandler({
  appBaseUrl: config.appBaseUrl,
  listVisibleProjects: (user) => listVisibleProjects(projectsDeps, user),
  listTasks: (viewer, slug) => listTasks(tasksDeps, viewer, slug),
  getTask: (viewer, slug, key) => getTask(tasksDeps, viewer, slug, key),
  createTask: (user, slug, body) => createTask(tasksDeps, user, slug, body),
  updateTask: (user, slug, key, body) => updateTask(tasksDeps, user, slug, key, body),
  addTaskDependency: (user, slug, key, dependsOnKey) => addTaskDependency(tasksDeps, user, slug, key, dependsOnKey),
  removeTaskDependency: (user, slug, key, dependsOnKey) =>
    removeTaskDependency(tasksDeps, user, slug, key, dependsOnKey),
  resolveApiTokenActor: (caller) => resolveApiTokenActor(apiTokensDeps, caller),
});

const app = createApp({
  checkDatabase: async () => {
    await sql`select 1`;
  },
  webDistDir: config.webDistDir,
  githubWebhookSecret: config.githubWebhookSecret,
  handlePullRequestEvent: (input) => handlePullRequestEvent(pullRequestWebhookStore, input, notifications),
  githubClientId: config.githubClientId,
  appBaseUrl: config.appBaseUrl,
  completeGithubLogin: (code) =>
    completeGithubLogin(
      { store: authStore, github: githubOAuthClient, adminLogins },
      code,
    ),
  findSessionUser: (sessionToken) => findSessionUser({ store: authStore, adminLogins }, sessionToken),
  endSession: (sessionToken) => endSession(authStore, sessionToken),
  listMembers: () => listMembers({ store: authStore, adminLogins }),
  addMember: (input) => addMember({ store: authStore, adminLogins }, input),
  removeMember: (githubLogin) => removeMember({ store: authStore, adminLogins }, githubLogin),
  listProjects: () => listProjects(projectsDeps),
  listVisibleProjects: (user) => listVisibleProjects(projectsDeps, user),
  createProject: (body) => createProject(projectsDeps, body),
  getProject: (slug) => getProject(projectsDeps, slug),
  updateProject: (slug, body) => updateProject(projectsDeps, slug, body),
  deleteProject: (slug) => deleteProject(projectsDeps, slug),
  addProjectRepository: (slug, fullName) => addProjectRepository(projectsDeps, slug, fullName),
  removeProjectRepository: (slug, fullName) => removeProjectRepository(projectsDeps, slug, fullName),
  addProjectMember: (slug, githubLogin) => addProjectMember(projectsDeps, slug, githubLogin),
  removeProjectMember: (slug, githubLogin) => removeProjectMember(projectsDeps, slug, githubLogin),
  listTasks: (user, slug) => listTasks(tasksDeps, user, slug),
  listParticipants: (user, slug) => listParticipants(tasksDeps, user, slug),
  getTask: (user, slug, key) => getTask(tasksDeps, user, slug, key),
  createTask: (user, slug, body) => createTask(tasksDeps, user, slug, body),
  takeTask: (user, slug, key) => takeTask(tasksDeps, user, slug, key),
  releaseTask: (user, slug, key) => releaseTask(tasksDeps, user, slug, key),
  updateTask: (user, slug, key, body) => updateTask(tasksDeps, user, slug, key, body),
  addTaskDependency: (user, slug, key, dependsOnKey) =>
    addTaskDependency(tasksDeps, user, slug, key, dependsOnKey),
  removeTaskDependency: (user, slug, key, dependsOnKey) =>
    removeTaskDependency(tasksDeps, user, slug, key, dependsOnKey),
  deleteTask: (user, slug, key) => deleteTask(tasksDeps, user, slug, key),
  discordApplicationId: config.discordOAuth?.applicationId,
  discordBotInstallEnabled: discordBotClient !== undefined,
  completeDiscordBotInstall: (slug, code) => completeDiscordBotInstall(discordBotDeps(), slug, code),
  listDiscordChannels: (slug) => listDiscordChannels(discordBotDeps(), slug),
  selectDiscordChannel: (slug, body) => selectDiscordChannel(discordBotDeps(), slug, body),
  completeDiscordLink: async (userId, code) => {
    // The app only routes here when linking is configured.
    if (discordOAuthClient === undefined) throw new Error("Discord account linking is disabled");
    return completeDiscordLink({ store: authStore, discord: discordOAuthClient }, userId, code);
  },
  findDiscordAccount: (userId) => findDiscordAccount(authStore, userId),
  unlinkDiscordAccount: (userId) => unlinkDiscordAccount(authStore, userId),
  discordPublicKey: config.discordPublicKey,
  handleDiscordInteraction,
  authenticateApiToken: (token) => authenticateApiToken(apiTokensDeps, token),
  rateLimitApiToken: (tokenId) => apiTokenRateLimiter.hit(String(tokenId)),
  listApiTokens: (slug) => listApiTokens(apiTokensDeps, slug),
  createApiToken: (slug, body, actor) => createApiToken(apiTokensDeps, slug, body, actor),
  revokeApiToken: (slug, tokenId) => revokeApiToken(apiTokensDeps, slug, tokenId),
  resolveApiTokenActor: (caller) => resolveApiTokenActor(apiTokensDeps, caller),
  listPersonalApiTokens: (owner) => listPersonalApiTokens(apiTokensDeps, owner),
  createPersonalApiToken: (body, owner) => createPersonalApiToken(apiTokensDeps, body, owner),
  revokePersonalApiToken: (owner, tokenId) => revokePersonalApiToken(apiTokensDeps, owner, tokenId),
  listProjectStages: (viewer, slug) => listProjectStages(tasksDeps, viewer, slug),
  listStages: (slug) => listStages(stagesDeps, slug),
  createStage: (slug, body) => createStage(stagesDeps, slug, body),
  updateStage: (slug, stageId, body) => updateStage(stagesDeps, slug, stageId, body),
  deleteStage: (slug, stageId) => deleteStage(stagesDeps, slug, stageId),
  handleMcpRequest,
});

/**
 * Background work after the server listens, never blocking or crashing startup: fill the
 * Discord server of projects configured by hand (needs the bot token), then register the
 * slash commands in every connected server (also needs the application id).
 */
async function syncDiscordOnStartup(): Promise<void> {
  if (config.discordBotToken === undefined) {
    console.log("Discord startup sync skipped: DISCORD_BOT_TOKEN is not set.");
    return;
  }
  const applicationId = config.discordOAuth?.applicationId;
  const deps = {
    store: projectStore,
    discord: createDiscordGuildSyncHttpClient({ applicationId, botToken: config.discordBotToken }),
  };
  const backfill = await backfillDiscordGuilds(deps);
  console.log(`Discord server backfill: ${backfill.filled} filled, ${backfill.failed} failed.`);
  if (applicationId === undefined) {
    console.log("Discord command sync skipped: DISCORD_APPLICATION_ID is not set.");
    return;
  }
  const sync = await syncDiscordCommands(deps);
  console.log(`Discord commands synced to ${sync.synced} servers (${sync.failed} failed).`);
}

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Server listening on port ${info.port}`);
  syncDiscordOnStartup().catch((error: unknown) => {
    console.error(`Discord startup sync failed: ${error instanceof Error ? error.message : String(error)}`);
  });
});

/** Gives pending notifications a few seconds to go out before exiting. */
const flushNotifications = () =>
  Promise.race([notifications.flush(), new Promise<void>((resolve) => setTimeout(resolve, 5_000).unref())]);

const shutdown = () => {
  server.close();
  void flushNotifications()
    .then(() => sql.end({ timeout: 5 }))
    .finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
