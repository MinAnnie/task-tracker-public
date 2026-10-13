import { DISCORD_COMMANDS, type DiscordCommandDefinition } from "../webhooks/discord/commands.ts";
import { USER_AGENT } from "./discord-notifier.ts";

const API_BASE = "https://discord.com/api/v10";
const TIMEOUT_MS = 10_000;

export interface RegisterDiscordCommandsOptions {
  applicationId: string;
  botToken: string;
  /** Registers in this guild only (updates apply instantly) instead of globally. */
  guildId?: string | undefined;
  commands?: readonly DiscordCommandDefinition[];
  fetch?: typeof globalThis.fetch;
}

/**
 * Replaces the application's slash commands with {@link DISCORD_COMMANDS} (a bulk
 * overwrite, so removed commands disappear too). Throws on any non-2xx answer; the
 * error carries Discord's status and body but never the bot token.
 */
export async function registerDiscordCommands({
  applicationId,
  botToken,
  guildId,
  commands = DISCORD_COMMANDS,
  fetch = globalThis.fetch,
}: RegisterDiscordCommandsOptions): Promise<{ scope: string; count: number }> {
  const app = `${API_BASE}/applications/${encodeURIComponent(applicationId)}`;
  const url = guildId ? `${app}/guilds/${encodeURIComponent(guildId)}/commands` : `${app}/commands`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      authorization: `Bot ${botToken}`,
      "content-type": "application/json",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).replaceAll(botToken, "[redacted]");
    throw new Error(`Discord refused the commands with status ${res.status}: ${body.slice(0, 500)}`);
  }
  return { scope: guildId ? `guild ${guildId}` : "global", count: commands.length };
}

/** Options for {@link registerDiscordCommands} from `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID`. */
export function registerOptionsFromEnv(env: NodeJS.ProcessEnv): RegisterDiscordCommandsOptions {
  const applicationId = env.DISCORD_APPLICATION_ID?.trim();
  if (!applicationId) throw new Error("DISCORD_APPLICATION_ID is required");
  const botToken = env.DISCORD_BOT_TOKEN?.trim();
  if (!botToken) throw new Error("DISCORD_BOT_TOKEN is required");
  return { applicationId, botToken, guildId: env.DISCORD_GUILD_ID?.trim() || undefined };
}
