import { describe, expect, it, vi } from "vitest";
import { DISCORD_COMMANDS } from "../webhooks/discord/commands.ts";
import { registerDiscordCommands, registerOptionsFromEnv } from "./discord-command-registrar.ts";
import { USER_AGENT } from "./discord-notifier.ts";

const ok = () => new Response(JSON.stringify([{ id: "1" }]), { status: 200 });

describe("registerDiscordCommands", () => {
  it("overwrites the global commands with the shared definitions", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok());

    await registerDiscordCommands({ applicationId: "123", botToken: "bot-token", fetch });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://discord.com/api/v10/applications/123/commands");
    expect(init?.method).toBe("PUT");
    expect(init?.headers).toEqual({
      authorization: "Bot bot-token",
      "content-type": "application/json",
      "user-agent": USER_AGENT,
    });
    expect(JSON.parse(String(init?.body))).toEqual(DISCORD_COMMANDS);
  });

  it("targets the guild commands when a guild id is given", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok());
    await registerDiscordCommands({ applicationId: "123", botToken: "t", guildId: "456", fetch });
    expect(fetch.mock.calls[0]![0]).toBe("https://discord.com/api/v10/applications/123/guilds/456/commands");
  });

  it("returns the scope and the number of registered commands", async () => {
    const fetch = vi.fn(async () => ok());
    expect(await registerDiscordCommands({ applicationId: "1", botToken: "t", fetch })).toEqual({
      scope: "global",
      count: DISCORD_COMMANDS.length,
    });
    expect(await registerDiscordCommands({ applicationId: "1", botToken: "t", guildId: "9", fetch })).toEqual({
      scope: "guild 9",
      count: DISCORD_COMMANDS.length,
    });
  });

  it("throws with Discord's status and error body, never the token", async () => {
    const fetch = vi.fn(async () => new Response('{"message":"401: Unauthorized"}', { status: 401 }));
    const attempt = registerDiscordCommands({ applicationId: "1", botToken: "secret-token", fetch });
    await expect(attempt).rejects.toThrow(/401.*Unauthorized/);
    await expect(registerDiscordCommands({ applicationId: "1", botToken: "secret-token", fetch })).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("secret-token") }),
    );
  });
});

describe("registerOptionsFromEnv", () => {
  it("reads the trimmed application id, bot token and optional guild id", () => {
    expect(
      registerOptionsFromEnv({ DISCORD_APPLICATION_ID: " 123 ", DISCORD_BOT_TOKEN: " t ", DISCORD_GUILD_ID: " " }),
    ).toEqual({ applicationId: "123", botToken: "t", guildId: undefined });
    expect(
      registerOptionsFromEnv({ DISCORD_APPLICATION_ID: "123", DISCORD_BOT_TOKEN: "t", DISCORD_GUILD_ID: "456" }),
    ).toEqual({ applicationId: "123", botToken: "t", guildId: "456" });
  });

  it("requires the application id and the bot token", () => {
    expect(() => registerOptionsFromEnv({ DISCORD_BOT_TOKEN: "t" })).toThrow("DISCORD_APPLICATION_ID is required");
    expect(() => registerOptionsFromEnv({ DISCORD_APPLICATION_ID: "1" })).toThrow("DISCORD_BOT_TOKEN is required");
  });
});
