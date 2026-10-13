import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

const env = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  DATABASE_URL: "postgres://localhost/db",
  GITHUB_WEBHOOK_SECRET: "s3cret",
  GITHUB_CLIENT_ID: "client-id",
  GITHUB_CLIENT_SECRET: "client-secret",
  ADMIN_GITHUB_LOGINS: "octocat",
  APP_BASE_URL: "https://tasks.example.com",
  ...overrides,
});

describe("loadConfig", () => {
  it("reads the GitHub webhook secret", () => {
    expect(loadConfig(env()).githubWebhookSecret).toBe("s3cret");
  });

  it("requires GITHUB_WEBHOOK_SECRET", () => {
    expect(() => loadConfig(env({ GITHUB_WEBHOOK_SECRET: undefined }))).toThrow(
      "GITHUB_WEBHOOK_SECRET is required",
    );
    expect(() => loadConfig(env({ GITHUB_WEBHOOK_SECRET: "" }))).toThrow(
      "GITHUB_WEBHOOK_SECRET is required",
    );
  });

  it("requires DATABASE_URL", () => {
    expect(() => loadConfig(env({ DATABASE_URL: undefined }))).toThrow("DATABASE_URL is required");
  });

  it("defaults PORT to 3000 and rejects invalid values", () => {
    expect(loadConfig(env()).port).toBe(3000);
    expect(() => loadConfig(env({ PORT: "abc" }))).toThrow("Invalid PORT: abc");
  });

  it("reads the GitHub OAuth client credentials", () => {
    const config = loadConfig(env());
    expect(config.githubClientId).toBe("client-id");
    expect(config.githubClientSecret).toBe("client-secret");
  });

  it("requires GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET", () => {
    expect(() => loadConfig(env({ GITHUB_CLIENT_ID: undefined }))).toThrow(
      "GITHUB_CLIENT_ID is required",
    );
    expect(() => loadConfig(env({ GITHUB_CLIENT_SECRET: "" }))).toThrow(
      "GITHUB_CLIENT_SECRET is required",
    );
  });

  it("parses ADMIN_GITHUB_LOGINS as trimmed, lowercased logins", () => {
    const config = loadConfig(env({ ADMIN_GITHUB_LOGINS: " OctoCat , hubot,, " }));
    expect(config.adminGithubLogins).toEqual(["octocat", "hubot"]);
  });

  it("requires at least one admin login (fails closed)", () => {
    for (const value of [undefined, "", " , ,"]) {
      expect(() => loadConfig(env({ ADMIN_GITHUB_LOGINS: value }))).toThrow(
        "ADMIN_GITHUB_LOGINS must list at least one GitHub login",
      );
    }
  });


  it("reads APP_BASE_URL as an origin without a trailing slash", () => {
    expect(loadConfig(env({ APP_BASE_URL: "https://tasks.example.com/" })).appBaseUrl).toBe(
      "https://tasks.example.com",
    );
    expect(loadConfig(env({ APP_BASE_URL: "http://localhost:3000" })).appBaseUrl).toBe(
      "http://localhost:3000",
    );
  });

  it("requires APP_BASE_URL", () => {
    expect(() => loadConfig(env({ APP_BASE_URL: undefined }))).toThrow("APP_BASE_URL is required");
  });

  it("rejects an APP_BASE_URL that is not an http(s) origin", () => {
    for (const value of ["not a url", "ftp://tasks.example.com", "https://tasks.example.com/app"]) {
      expect(() => loadConfig(env({ APP_BASE_URL: value }))).toThrow(
        `Invalid APP_BASE_URL: ${value}`,
      );
    }
  });

  it("reads an optional, trimmed DISCORD_BOT_TOKEN (unset or blank disables notifications)", () => {
    expect(loadConfig(env()).discordBotToken).toBeUndefined();
    expect(loadConfig(env({ DISCORD_BOT_TOKEN: "  " })).discordBotToken).toBeUndefined();
    expect(loadConfig(env({ DISCORD_BOT_TOKEN: " bot-token " })).discordBotToken).toBe("bot-token");
  });

  describe("Discord account linking", () => {
    it("is disabled when neither DISCORD_APPLICATION_ID nor DISCORD_CLIENT_SECRET is set", () => {
      expect(loadConfig(env()).discordOAuth).toBeUndefined();
      expect(
        loadConfig(env({ DISCORD_APPLICATION_ID: "  ", DISCORD_CLIENT_SECRET: "" })).discordOAuth,
      ).toBeUndefined();
    });

    it("is enabled with trimmed values when both are set", () => {
      expect(
        loadConfig(env({ DISCORD_APPLICATION_ID: " 1234 ", DISCORD_CLIENT_SECRET: " shh " })).discordOAuth,
      ).toEqual({ applicationId: "1234", clientSecret: "shh" });
    });

    it.each([
      [{ DISCORD_APPLICATION_ID: "1234" }],
      [{ DISCORD_CLIENT_SECRET: "shh" }],
      [{ DISCORD_APPLICATION_ID: "1234", DISCORD_CLIENT_SECRET: "   " }],
    ])("fails when only one of the pair is set (%o)", (overrides) => {
      expect(() => loadConfig(env(overrides))).toThrow(
        "DISCORD_APPLICATION_ID and DISCORD_CLIENT_SECRET must be set together",
      );
    });

    it("never puts the client secret in the error message", () => {
      expect(() => loadConfig(env({ DISCORD_CLIENT_SECRET: "top-secret-value" }))).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining("top-secret-value") }),
      );
    });
  });

  describe("Discord interactions", () => {
    const key = "a".repeat(64);

    it("are disabled when DISCORD_PUBLIC_KEY is unset or blank", () => {
      expect(loadConfig(env()).discordPublicKey).toBeUndefined();
      expect(loadConfig(env({ DISCORD_PUBLIC_KEY: "  " })).discordPublicKey).toBeUndefined();
    });

    it("read a trimmed, lowercased 64-hex-character DISCORD_PUBLIC_KEY", () => {
      expect(loadConfig(env({ DISCORD_PUBLIC_KEY: ` ${"AB".repeat(32)} ` })).discordPublicKey).toBe(
        "ab".repeat(32),
      );
      expect(loadConfig(env({ DISCORD_PUBLIC_KEY: key })).discordPublicKey).toBe(key);
    });

    it.each([["a".repeat(63)], ["a".repeat(65)], ["z".repeat(64)]])("reject the malformed key %s", (value) => {
      expect(() => loadConfig(env({ DISCORD_PUBLIC_KEY: value }))).toThrow(
        "DISCORD_PUBLIC_KEY must be 64 hexadecimal characters",
      );
    });
  });
});
