import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryProjectStore } from "../../test/fakes/in-memory-project-store.ts";
import {
  backfillDiscordGuilds,
  syncDiscordCommands,
  type DiscordGuildSyncClient,
  type DiscordGuildSyncDeps,
} from "./discord-guild-sync.ts";
import type { ProjectChanges } from "./project-store.ts";

const GUILD_A = "111111111111111111";
const GUILD_B = "222222222222222222";
const CHANNEL_1 = "333333333333333333";
const CHANNEL_2 = "444444444444444444";
const CHANNEL_3 = "555555555555555555";

class FakeGuildSyncClient implements DiscordGuildSyncClient {
  /** Guild of each channel; a missing channel throws like a 404. */
  guildOfChannel = new Map<string, string | undefined>();
  failingGuilds = new Set<string>();
  fetched: string[] = [];
  registered: string[] = [];

  async fetchChannelGuildId(channelId: string) {
    this.fetched.push(channelId);
    if (!this.guildOfChannel.has(channelId)) throw new Error("Discord channel lookup failed with status 404");
    return this.guildOfChannel.get(channelId);
  }

  async registerGuildCommands(guildId: string) {
    this.registered.push(guildId);
    if (this.failingGuilds.has(guildId)) throw new Error("Discord refused the commands with status 403");
  }
}

describe("Discord startup sync", () => {
  let store: InMemoryProjectStore;
  let discord: FakeGuildSyncClient;
  let log: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
  let deps: DiscordGuildSyncDeps;

  const seed = async (slug: string, prefix: string, changes: ProjectChanges) => {
    const created = await store.createProject({ slug, name: slug, taskKeyPrefix: prefix, discordChannelId: null });
    if (created.status !== "saved") throw new Error("seed failed");
    await store.updateProject(created.project.id, changes);
  };
  const guildOf = async (slug: string) => (await store.findProjectBySlug(slug))?.discordGuildId;

  beforeEach(() => {
    store = new InMemoryProjectStore();
    discord = new FakeGuildSyncClient();
    log = vi.fn<(...args: unknown[]) => void>();
    deps = { store, discord, log };
  });

  describe("backfillDiscordGuilds", () => {
    it("fills the guild of projects that have a channel but no guild, and only those", async () => {
      await seed("shop", "RF", { discordChannelId: CHANNEL_1 });
      await seed("blog", "BL", { discordChannelId: CHANNEL_2, discordGuildId: GUILD_B });
      await seed("docs", "DC", {});
      discord.guildOfChannel.set(CHANNEL_1, GUILD_A);
      discord.guildOfChannel.set(CHANNEL_2, GUILD_A);

      expect(await backfillDiscordGuilds(deps)).toEqual({ filled: 1, failed: 0 });
      expect(await guildOf("shop")).toBe(GUILD_A);
      expect(await guildOf("blog")).toBe(GUILD_B);
      expect(await guildOf("docs")).toBeNull();
      expect(discord.fetched).toEqual([CHANNEL_1]);
    });

    it("logs and skips channels Discord cannot resolve or that return no valid guild", async () => {
      await seed("a", "AA", { discordChannelId: CHANNEL_1 });
      await seed("b", "BB", { discordChannelId: CHANNEL_2 });
      await seed("c", "CC", { discordChannelId: CHANNEL_3 });
      discord.guildOfChannel.set(CHANNEL_2, "not-a-snowflake");
      discord.guildOfChannel.set(CHANNEL_3, GUILD_B);

      expect(await backfillDiscordGuilds(deps)).toEqual({ filled: 1, failed: 2 });
      expect(await guildOf("a")).toBeNull();
      expect(await guildOf("b")).toBeNull();
      expect(await guildOf("c")).toBe(GUILD_B);
      expect(log).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(log.mock.calls)).toContain("404");
    });
  });

  describe("syncDiscordCommands", () => {
    it("registers the commands once per distinct connected guild", async () => {
      await seed("a", "AA", { discordGuildId: GUILD_A });
      await seed("b", "BB", { discordGuildId: GUILD_B });
      await seed("c", "CC", { discordGuildId: GUILD_A });
      await seed("d", "DD", {});

      expect(await syncDiscordCommands(deps)).toEqual({ synced: 2, failed: 0 });
      expect([...discord.registered].sort()).toEqual([GUILD_A, GUILD_B]);
    });

    it("keeps going when one guild fails, logging it", async () => {
      await seed("a", "AA", { discordGuildId: GUILD_A });
      await seed("b", "BB", { discordGuildId: GUILD_B });
      discord.failingGuilds.add(GUILD_A);

      expect(await syncDiscordCommands(deps)).toEqual({ synced: 1, failed: 1 });
      expect(discord.registered).toContain(GUILD_B);
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(log.mock.calls)).toContain(GUILD_A);
    });
  });
});
