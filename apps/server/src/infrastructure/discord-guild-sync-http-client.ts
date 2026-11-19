import type { DiscordGuildSyncClient } from "../application/discord-guild-sync.ts";
import { registerDiscordCommands } from "./discord-command-registrar.ts";
import { retryDelayMs, USER_AGENT } from "./discord-notifier.ts";

const API_BASE = "https://discord.com/api/v10";
const TIMEOUT_MS = 10_000;

export interface DiscordGuildSyncHttpClientOptions {
  /** Needed to register commands; without it only channel lookups work. */
  applicationId: string | undefined;
  botToken: string;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `fetch` that retries a 429 once after Discord's `retry_after` (capped), with a fresh
 * timeout for the retry, like the notifier does.
 */
function retryingOnce429(fetch: typeof globalThis.fetch, sleep: (ms: number) => Promise<void>): typeof globalThis.fetch {
  return async (input, init) => {
    const res = await fetch(input, init);
    if (res.status !== 429) return res;
    await sleep(await retryDelayMs(res));
    return fetch(input, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  };
}

/**
 * HTTP adapter for {@link DiscordGuildSyncClient} using the bot token, with bounded
 * timeouts and one retry on 429. Errors carry Discord's status and a trimmed body with
 * the token redacted.
 */
export function createDiscordGuildSyncHttpClient({
  applicationId,
  botToken,
  fetch = globalThis.fetch,
  sleep = defaultSleep,
}: DiscordGuildSyncHttpClientOptions): DiscordGuildSyncClient {
  const send = retryingOnce429(fetch, sleep);
  return {
    async fetchChannelGuildId(channelId) {
      const res = await send(`${API_BASE}/channels/${encodeURIComponent(channelId)}`, {
        headers: { authorization: `Bot ${botToken}`, "user-agent": USER_AGENT, accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => "")).replaceAll(botToken, "[redacted]");
        throw new Error(`Discord channel lookup failed with status ${res.status}: ${body.slice(0, 300)}`);
      }
      const body = (await res.json().catch(() => ({}))) as { guild_id?: unknown };
      return typeof body.guild_id === "string" ? body.guild_id : undefined;
    },

    async registerGuildCommands(guildId) {
      if (applicationId === undefined) throw new Error("DISCORD_APPLICATION_ID is required to register commands");
      await registerDiscordCommands({ applicationId, botToken, guildId, fetch: send });
    },
  };
}
