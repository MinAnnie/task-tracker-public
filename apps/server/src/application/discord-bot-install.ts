import { selectableDiscordChannels, type DiscordChannel } from "../domain/discord-channels.ts";
import {
  normalizeDiscordChannelId,
  normalizeDiscordGuildId,
  normalizeDiscordInviteUrl,
  normalizeProjectSlug,
} from "../domain/project-fields.ts";
import type { ProjectChanges, ProjectRecord, ProjectStore } from "./project-store.ts";

/** The Discord server (guild) the bot was installed in. */
export interface DiscordGuild {
  id: string;
  name: string;
}

export type DiscordGuildChannel = DiscordChannel;

/**
 * Port for the Discord REST calls of the "Connect Discord" flow. Implemented by an
 * HTTP adapter; implementations never log the client secret or the bot token.
 */
export interface DiscordBotClient {
  /**
   * Trades a bot-install authorization `code` for the guild Discord added the bot to,
   * read from the token response's `guild` object; the access token is discarded.
   * Throws when Discord refuses the code or the response has no guild.
   */
  exchangeBotInstallCode(code: string): Promise<DiscordGuild>;
  /** Every channel of the guild, read with the bot token. */
  listGuildChannels(guildId: string): Promise<DiscordGuildChannel[]>;
  /** Uploads the slash command definitions to the guild (a bulk overwrite). */
  registerGuildCommands(guildId: string): Promise<void>;
  /** Creates a never-expiring, unlimited invite to the channel; resolves its code. */
  createChannelInvite(channelId: string): Promise<string>;
}

export interface DiscordBotInstallDeps {
  store: ProjectStore;
  discord: DiscordBotClient;
  /** Where non-blocking failures go; defaults to `console.error`. */
  log?: (...args: unknown[]) => void;
}

/** A project that already posts to a channel. */
export interface ChannelOwner {
  slug: string;
  name: string;
}

/** A channel the project may pick; `usedBy` names another project already posting there. */
export interface DiscordChannelOption {
  id: string;
  name: string;
  type: number;
  usedBy: ChannelOwner | null;
}

/** Follow-ups of a channel selection that failed without undoing it. */
export type DiscordChannelWarning = "commands_not_registered" | "invite_not_created";

export type CompleteDiscordBotInstallResult =
  | { status: "connected"; guild: DiscordGuild }
  | { status: "project_not_found" };

export type ListDiscordChannelsResult =
  | { status: "ok"; guildId: string; channels: DiscordChannelOption[] }
  | { status: "project_not_found" }
  | { status: "discord_not_connected" };

export type SelectDiscordChannelResult =
  | { status: "saved"; project: ProjectRecord; warnings: DiscordChannelWarning[] }
  | { status: "invalid"; field: "discordChannelId" }
  | { status: "project_not_found" }
  | { status: "discord_not_connected" }
  | { status: "channel_not_in_guild" }
  | { status: "channel_taken"; project: ChannelOwner };

async function findProject(store: ProjectStore, slug: string): Promise<ProjectRecord | undefined> {
  const normalized = normalizeProjectSlug(slug);
  return normalized === undefined ? undefined : store.findProjectBySlug(normalized);
}

/** Error name and message only: request details (and secrets) stay out of the logs. */
function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Finishes the bot install started from a project's settings: the guild comes only
 * from Discord's token response (never from the callback's `guild_id` query
 * parameter) and is stored on the project. The project's channel is left as is.
 */
export async function completeDiscordBotInstall(
  { store, discord }: DiscordBotInstallDeps,
  slug: string,
  code: string,
): Promise<CompleteDiscordBotInstallResult> {
  const project = await findProject(store, slug);
  if (project === undefined) return { status: "project_not_found" };

  const guild = await discord.exchangeBotInstallCode(code);
  const guildId = normalizeDiscordGuildId(guild.id);
  if (guildId === undefined) throw new Error("Discord returned an invalid guild id");

  const result = await store.updateProject(project.id, { discordGuildId: guildId });
  if (result.status !== "saved") throw new Error("Saving the Discord guild failed");
  return { status: "connected", guild: { id: guildId, name: guild.name } };
}

/** Which other project posts to each channel id. */
async function channelOwners(store: ProjectStore, exceptProjectId: number): Promise<Map<string, ChannelOwner>> {
  const owners = new Map<string, ChannelOwner>();
  for (const project of await store.listProjects()) {
    if (project.id === exceptProjectId || project.discordChannelId === null) continue;
    if (!owners.has(project.discordChannelId)) {
      owners.set(project.discordChannelId, { slug: project.slug, name: project.name });
    }
  }
  return owners;
}

/**
 * The text and announcement channels of the project's connected guild, read live with
 * the bot token, each with the other project already posting there (if any).
 * Discord failures propagate.
 */
export async function listDiscordChannels(
  { store, discord }: DiscordBotInstallDeps,
  slug: string,
): Promise<ListDiscordChannelsResult> {
  const project = await findProject(store, slug);
  if (project === undefined) return { status: "project_not_found" };
  if (project.discordGuildId === null) return { status: "discord_not_connected" };

  const [channels, owners] = await Promise.all([
    discord.listGuildChannels(project.discordGuildId),
    channelOwners(store, project.id),
  ]);
  return {
    status: "ok",
    guildId: project.discordGuildId,
    channels: selectableDiscordChannels(channels).map(({ id, name, type }) => ({
      id,
      name,
      type,
      usedBy: owners.get(id) ?? null,
    })),
  };
}

/**
 * Makes the project post to `body.channelId` (untrusted). The channel must be a text or
 * announcement channel of the project's connected guild right now (re-listed with the
 * bot) and must not be another project's channel. After saving, the slash commands are
 * registered in the guild and a never-expiring invite to the channel fills the
 * project's invite link; those follow-ups may fail without undoing the selection:
 * each failure is logged and reported as a warning (the previous invite stays).
 */
export async function selectDiscordChannel(
  { store, discord, log = console.error }: DiscordBotInstallDeps,
  slug: string,
  body: unknown,
): Promise<SelectDiscordChannelResult> {
  const isObject = typeof body === "object" && body !== null && !Array.isArray(body);
  const channelId = normalizeDiscordChannelId(isObject ? (body as { channelId?: unknown }).channelId : undefined);
  if (channelId === undefined || channelId === null) return { status: "invalid", field: "discordChannelId" };

  const project = await findProject(store, slug);
  if (project === undefined) return { status: "project_not_found" };
  const guildId = project.discordGuildId;
  if (guildId === null) return { status: "discord_not_connected" };

  const channels = selectableDiscordChannels(await discord.listGuildChannels(guildId));
  if (!channels.some((channel) => channel.id === channelId)) return { status: "channel_not_in_guild" };
  const owner = (await channelOwners(store, project.id)).get(channelId);
  if (owner !== undefined) return { status: "channel_taken", project: owner };

  const saved = await store.updateProject(project.id, { discordChannelId: channelId });
  if (saved.status !== "saved") throw new Error("Saving the Discord channel failed");

  const warnings: DiscordChannelWarning[] = [];
  try {
    await discord.registerGuildCommands(guildId);
  } catch (error) {
    log(`Registering Discord commands in guild ${guildId} failed: ${describeError(error)}`);
    warnings.push("commands_not_registered");
  }

  const changes: ProjectChanges = {};
  try {
    const code = await discord.createChannelInvite(channelId);
    const inviteUrl = normalizeDiscordInviteUrl(`https://discord.gg/${code}`);
    if (typeof inviteUrl !== "string") throw new Error("Discord returned an invalid invite code");
    changes.discordInviteUrl = inviteUrl;
  } catch (error) {
    log(`Creating a Discord invite for channel ${channelId} failed: ${describeError(error)}`);
    warnings.push("invite_not_created");
  }
  if (changes.discordInviteUrl === undefined) return { status: "saved", project: saved.project, warnings };

  const withInvite = await store.updateProject(project.id, changes);
  if (withInvite.status !== "saved") throw new Error("Saving the Discord invite failed");
  return { status: "saved", project: withInvite.project, warnings };
}
