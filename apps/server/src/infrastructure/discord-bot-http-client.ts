import type { DiscordBotClient, DiscordGuild, DiscordGuildChannel } from "../application/discord-bot-install.ts";
import { registerDiscordCommands } from "./discord-command-registrar.ts";
import { USER_AGENT } from "./discord-notifier.ts";

const API_BASE = "https://discord.com/api/v10";
const TIMEOUT_MS = 10_000;

export interface DiscordBotHttpClientOptions {
  /** The Discord application id (OAuth2 client id). */
  applicationId: string;
  clientSecret: string;
  botToken: string;
  /** Must match the `redirect_uri` sent to the authorize endpoint. */
  redirectUri: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * HTTP adapter for {@link DiscordBotClient} over Discord's REST API v10. Every request
 * has a bounded timeout. Errors carry Discord's status and a trimmed body with the bot
 * token redacted; the client secret, the code and access tokens never appear in them.
 */
export function createDiscordBotHttpClient({
  applicationId,
  clientSecret,
  botToken,
  redirectUri,
  fetch = globalThis.fetch,
}: DiscordBotHttpClientOptions): DiscordBotClient {
  const botHeaders = { authorization: `Bot ${botToken}`, "user-agent": USER_AGENT };

  const failure = async (what: string, res: Response) => {
    const body = (await res.text().catch(() => "")).replaceAll(botToken, "[redacted]");
    return new Error(`${what} failed with status ${res.status}: ${body.slice(0, 300)}`);
  };

  return {
    async exchangeBotInstallCode(code) {
      const res = await fetch(`${API_BASE}/oauth2/token`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: applicationId,
          client_secret: clientSecret,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: unknown; guild?: unknown };
      if (!res.ok) {
        const reason = typeof body.error === "string" ? `: ${body.error}` : "";
        throw new Error(`Discord token exchange failed with status ${res.status}${reason}`);
      }
      // The access token in the same response is deliberately ignored and discarded.
      return toGuild(body.guild);
    },

    async listGuildChannels(guildId) {
      const res = await fetch(`${API_BASE}/guilds/${encodeURIComponent(guildId)}/channels`, {
        headers: { ...botHeaders, accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw await failure("Discord channel list", res);
      const body: unknown = await res.json();
      if (!Array.isArray(body)) throw new Error("Discord channel list has an unexpected shape");
      return body.flatMap(toChannel);
    },

    async registerGuildCommands(guildId) {
      await registerDiscordCommands({ applicationId, botToken, guildId, fetch });
    },

    async createChannelInvite(channelId) {
      const res = await fetch(`${API_BASE}/channels/${encodeURIComponent(channelId)}/invites`, {
        method: "POST",
        headers: { ...botHeaders, "content-type": "application/json" },
        body: JSON.stringify({ max_age: 0, max_uses: 0, unique: false }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw await failure("Discord invite creation", res);
      const body = (await res.json().catch(() => ({}))) as { code?: unknown };
      if (typeof body.code !== "string" || body.code === "") throw new Error("Discord invite response has no code");
      return body.code;
    },
  };
}

function toGuild(value: unknown): DiscordGuild {
  const guild = (value ?? {}) as Record<string, unknown>;
  if (typeof guild.id !== "string" || typeof guild.name !== "string") {
    throw new Error("Discord token response has no guild");
  }
  return { id: guild.id, name: guild.name };
}

/** Keeps well-formed channels only; anything else in the list is skipped. */
function toChannel(value: unknown): DiscordGuildChannel[] {
  const channel = (value ?? {}) as Record<string, unknown>;
  const { id, name, type, position } = channel;
  if (typeof id !== "string" || typeof name !== "string" || typeof type !== "number") return [];
  return [{ id, name, type, position: typeof position === "number" ? position : 0 }];
}
