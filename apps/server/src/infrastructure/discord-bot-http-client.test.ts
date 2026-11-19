import { describe, expect, it, vi } from "vitest";
import { DISCORD_COMMANDS } from "../webhooks/discord/commands.ts";
import { createDiscordBotHttpClient } from "./discord-bot-http-client.ts";
import { USER_AGENT } from "./discord-notifier.ts";

const GUILD = "111111111111111111";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const clientWith = (respond: (url: string, init?: RequestInit) => Response) => {
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => respond(String(url), init));
  const client = createDiscordBotHttpClient({
    applicationId: "app-1",
    clientSecret: "client-secret",
    botToken: "bot-token",
    redirectUri: "https://tasks.example.com/auth/discord/callback",
    fetch,
  });
  return { client, fetch };
};

describe("createDiscordBotHttpClient", () => {
  describe("exchangeBotInstallCode", () => {
    it("posts the code grant to the v10 token endpoint and returns only the response's guild", async () => {
      const { client, fetch } = clientWith(() =>
        json({ access_token: "user-token", token_type: "Bearer", guild: { id: GUILD, name: "Acme", owner_id: "9" } }),
      );

      expect(await client.exchangeBotInstallCode("the-code")).toEqual({ id: GUILD, name: "Acme" });

      const [url, init] = fetch.mock.calls[0]!;
      expect(url).toBe("https://discord.com/api/v10/oauth2/token");
      expect(init?.method).toBe("POST");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
        grant_type: "authorization_code",
        code: "the-code",
        redirect_uri: "https://tasks.example.com/auth/discord/callback",
        client_id: "app-1",
        client_secret: "client-secret",
      });
    });

    it.each([
      ["without a guild", { access_token: "t" }],
      ["with a malformed guild", { access_token: "t", guild: { id: 5, name: "x" } }],
    ])("throws %s", async (_case, body) => {
      const { client } = clientWith(() => json(body));
      await expect(client.exchangeBotInstallCode("c")).rejects.toThrow(/guild/);
    });

    it("throws with Discord's status and error, never the secret or the code", async () => {
      const { client } = clientWith(() => json({ error: "invalid_grant" }, 400));
      const attempt = client.exchangeBotInstallCode("the-code");
      await expect(attempt).rejects.toThrow(/400: invalid_grant/);
      await expect(client.exchangeBotInstallCode("the-code")).rejects.toThrow(
        expect.objectContaining({ message: expect.not.stringMatching(/client-secret|the-code/) }),
      );
    });
  });

  describe("listGuildChannels", () => {
    it("reads the guild's channels with the bot token", async () => {
      const { client, fetch } = clientWith(() =>
        json([
          { id: "333333333333333333", name: "general", type: 0, position: 1, parent_id: null },
          { id: "444444444444444444", name: "Voice", type: 2, position: 0 },
          { id: 7, name: "broken" },
        ]),
      );

      expect(await client.listGuildChannels(GUILD)).toEqual([
        { id: "333333333333333333", name: "general", type: 0, position: 1 },
        { id: "444444444444444444", name: "Voice", type: 2, position: 0 },
      ]);
      const [url, init] = fetch.mock.calls[0]!;
      expect(url).toBe(`https://discord.com/api/v10/guilds/${GUILD}/channels`);
      expect(init?.headers).toEqual(expect.objectContaining({ authorization: "Bot bot-token", "user-agent": USER_AGENT }));
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });

    it("throws on a refusal without leaking the bot token", async () => {
      const { client } = clientWith(() => json({ message: "Missing Access bot-token" }, 403));
      await expect(client.listGuildChannels(GUILD)).rejects.toThrow(
        expect.objectContaining({ message: expect.stringContaining("403") }),
      );
      await expect(client.listGuildChannels(GUILD)).rejects.toThrow(
        expect.objectContaining({ message: expect.not.stringContaining("bot-token") }),
      );
    });

    it("throws when the answer is not a list", async () => {
      const { client } = clientWith(() => json({ nope: true }));
      await expect(client.listGuildChannels(GUILD)).rejects.toThrow();
    });
  });

  describe("registerGuildCommands", () => {
    it("overwrites the guild's commands with the shared definitions", async () => {
      const { client, fetch } = clientWith(() => json([]));
      await client.registerGuildCommands(GUILD);
      const [url, init] = fetch.mock.calls[0]!;
      expect(url).toBe(`https://discord.com/api/v10/applications/app-1/guilds/${GUILD}/commands`);
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual(DISCORD_COMMANDS);
    });

    it("throws when Discord refuses them", async () => {
      const { client } = clientWith(() => json({ message: "Missing Access" }, 403));
      await expect(client.registerGuildCommands(GUILD)).rejects.toThrow(/403/);
    });
  });

  describe("createChannelInvite", () => {
    it("creates a never-expiring, unlimited, reusable invite and returns its code", async () => {
      const { client, fetch } = clientWith(() => json({ code: "AbC123", max_age: 0 }));
      expect(await client.createChannelInvite("333333333333333333")).toBe("AbC123");
      const [url, init] = fetch.mock.calls[0]!;
      expect(url).toBe("https://discord.com/api/v10/channels/333333333333333333/invites");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual(expect.objectContaining({ authorization: "Bot bot-token", "content-type": "application/json" }));
      expect(JSON.parse(String(init?.body))).toEqual({ max_age: 0, max_uses: 0, unique: false });
    });

    it("throws on a refusal or an answer without a code", async () => {
      await expect(clientWith(() => json({ message: "Missing Permissions" }, 403)).client.createChannelInvite("1")).rejects.toThrow(
        /403/,
      );
      await expect(clientWith(() => json({})).client.createChannelInvite("1")).rejects.toThrow(/code/);
    });
  });
});
