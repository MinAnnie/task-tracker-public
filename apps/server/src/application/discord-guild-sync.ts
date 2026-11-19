import { normalizeDiscordGuildId } from "../domain/project-fields.ts";
import type { ProjectStore } from "./project-store.ts";

/** Port for the bot-token Discord calls run at startup. Implementations never log the token. */
export interface DiscordGuildSyncClient {
  /** The guild a channel belongs to (`undefined` when it has none); throws when Discord refuses. */
  fetchChannelGuildId(channelId: string): Promise<string | undefined>;
  /** Uploads the shared slash command definitions to the guild (an idempotent bulk overwrite). */
  registerGuildCommands(guildId: string): Promise<void>;
}

export interface DiscordGuildSyncDeps {
  store: ProjectStore;
  discord: DiscordGuildSyncClient;
  /** Where per-item failures go; defaults to `console.error`. */
  log?: (...args: unknown[]) => void;
}

/** Error name and message only: request details (and the token) stay out of the logs. */
function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Fills the Discord server of projects configured by hand (a channel but no guild) from
 * the channel itself, so they get slash commands without reconnecting. Runs one project
 * at a time; a channel Discord cannot resolve is logged and skipped. Never throws for
 * Discord failures.
 */
export async function backfillDiscordGuilds({
  store,
  discord,
  log = console.error,
}: DiscordGuildSyncDeps): Promise<{ filled: number; failed: number }> {
  let filled = 0;
  let failed = 0;
  for (const project of await store.listProjects()) {
    if (project.discordChannelId === null || project.discordGuildId !== null) continue;
    try {
      const guildId = normalizeDiscordGuildId(await discord.fetchChannelGuildId(project.discordChannelId));
      if (guildId === undefined) throw new Error("the channel has no valid guild id");
      await store.updateProject(project.id, { discordGuildId: guildId });
      filled += 1;
    } catch (error) {
      failed += 1;
      log(`Discord guild backfill for project ${project.slug} failed: ${describeError(error)}`);
    }
  }
  return { filled, failed };
}

/**
 * Registers the slash commands in every distinct guild connected to a project, one
 * guild at a time, so command changes reach every server on each start. A failing
 * guild is logged and skipped. Never throws for Discord failures.
 */
export async function syncDiscordCommands({
  store,
  discord,
  log = console.error,
}: DiscordGuildSyncDeps): Promise<{ synced: number; failed: number }> {
  const guilds = new Set<string>();
  for (const project of await store.listProjects()) {
    if (project.discordGuildId !== null) guilds.add(project.discordGuildId);
  }
  let synced = 0;
  let failed = 0;
  for (const guildId of guilds) {
    try {
      await discord.registerGuildCommands(guildId);
      synced += 1;
    } catch (error) {
      failed += 1;
      log(`Registering Discord commands in guild ${guildId} failed: ${describeError(error)}`);
    }
  }
  return { synced, failed };
}
