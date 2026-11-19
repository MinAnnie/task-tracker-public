import { describe, expect, it, vi } from "vitest";
import { DISCORD_COMMANDS } from "../webhooks/discord/commands.ts";
import { createDiscordGuildSyncHttpClient } from "./discord-guild-sync-http-client.ts";
import { USER_AGENT } from "./discord-notifier.ts";

const CHANNEL = "333333333333333333";
const GUILD = "111111111111111111";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const clientWith = (...responses: Response[]) => {
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => responses.shift() ?? json({}, 500));
  const sleep = vi.fn(async (_ms: number) => {});
  const client = createDiscordGuildSyncHttpClient({ applicationId: "app-1", botToken: "bot-token", fetch, sleep });
  return { client, fetch, sleep };
};

describe("createDiscordGuildSyncHttpClient", () => {
  describe("fetchChannelGuildId", () => {
    it("reads the channel with the bot token and returns its guild_id", async () => {
      const { client, fetch } = clientWith(json({ id: CHANNEL, guild_id: GUILD, type: 0 }));
      expect(await client.fetchChannelGuildId(CHANNEL)).toBe(GUILD);
      const [url, init] = fetch.mock.calls[0]!;
      expect(url).toBe(`https://discord.com/api/v10/channels/${CHANNEL}`);
      expect(init?.headers).toEqual(expect.objectContaining({ authorization: "Bot bot-token", "user-agent": USER_AGENT }));
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });

    it("returns undefined for a channel without a guild", async () => {
      const { client } = clientWith(json({ id: CHANNEL, type: 1 }));
      expect(await client.fetchChannelGuildId(CHANNEL)).toBeUndefined();
    });

    it("throws on a refusal without leaking the token", async () => {
      const { client } = clientWith(json({ message: "Unknown Channel bot-token" }, 404));
      const attempt = client.fetchChannelGuildId(CHANNEL);
      await expect(attempt).rejects.toThrow(/404/);
      await expect(attempt).rejects.toThrow(expect.objectContaining({ message: expect.not.stringContaining("bot-token") }));
    });

    it("retries a 429 once after retry_after", async () => {
      const { client, fetch, sleep } = clientWith(json({ retry_after: 1.5 }, 429), json({ guild_id: GUILD }));
      expect(await client.fetchChannelGuildId(CHANNEL)).toBe(GUILD);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledWith(1500);
    });

    it("gives up after a second 429", async () => {
      const { client, fetch } = clientWith(json({ retry_after: 0 }, 429), json({ retry_after: 0 }, 429));
      await expect(client.fetchChannelGuildId(CHANNEL)).rejects.toThrow(/429/);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("registerGuildCommands", () => {
    it("overwrites the guild's commands with the shared definitions", async () => {
      const { client, fetch } = clientWith(json([]));
      await client.registerGuildCommands(GUILD);
      const [url, init] = fetch.mock.calls[0]!;
      expect(url).toBe(`https://discord.com/api/v10/applications/app-1/guilds/${GUILD}/commands`);
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual(DISCORD_COMMANDS);
    });

    it("retries a 429 once", async () => {
      const { client, fetch } = clientWith(json({ retry_after: 0 }, 429), json([]));
      await client.registerGuildCommands(GUILD);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("throws without calling Discord when there is no application id", async () => {
      const fetch = vi.fn();
      const client = createDiscordGuildSyncHttpClient({ applicationId: undefined, botToken: "t", fetch });
      await expect(client.registerGuildCommands(GUILD)).rejects.toThrow(/DISCORD_APPLICATION_ID/);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("throws when Discord refuses them", async () => {
      const { client } = clientWith(json({ message: "Missing Access" }, 403));
      await expect(client.registerGuildCommands(GUILD)).rejects.toThrow(/403/);
    });
  });
});
