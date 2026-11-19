import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDiscordBotClient } from "../../test/fakes/fake-discord-bot-client.ts";
import { InMemoryProjectStore } from "../../test/fakes/in-memory-project-store.ts";
import {
  completeDiscordBotInstall,
  listDiscordChannels,
  selectDiscordChannel,
  type DiscordBotInstallDeps,
} from "./discord-bot-install.ts";
import type { ProjectRecord } from "./project-store.ts";

const GUILD = "111111111111111111";
const OTHER_GUILD = "222222222222222222";
const GENERAL = "333333333333333333";
const NEWS = "444444444444444444";
const VOICE = "555555555555555555";

describe("Discord bot install", () => {
  let store: InMemoryProjectStore;
  let discord: FakeDiscordBotClient;
  let log: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
  let deps: DiscordBotInstallDeps;

  const seedProject = async (slug: string, prefix: string, extra: Partial<ProjectRecord> = {}) => {
    const result = await store.createProject({ slug, name: slug.toUpperCase(), taskKeyPrefix: prefix, discordChannelId: null });
    if (result.status !== "saved") throw new Error("seed failed");
    if (Object.keys(extra).length === 0) return result.project;
    const updated = await store.updateProject(result.project.id, extra);
    if (updated.status !== "saved") throw new Error("seed failed");
    return updated.project;
  };

  beforeEach(() => {
    store = new InMemoryProjectStore();
    discord = new FakeDiscordBotClient();
    discord.codes.set("the-code", { id: GUILD, name: "Acme" });
    discord.channels.set(GUILD, [
      { id: NEWS, name: "news", type: 5, position: 2 },
      { id: VOICE, name: "Lounge", type: 2, position: 0 },
      { id: GENERAL, name: "general", type: 0, position: 1 },
    ]);
    log = vi.fn<(...args: unknown[]) => void>();
    deps = { store, discord, log };
  });

  describe("completeDiscordBotInstall", () => {
    it("stores the guild from the token response on the project", async () => {
      const shop = await seedProject("shop", "RF");

      expect(await completeDiscordBotInstall(deps, "Shop", "the-code")).toEqual({
        status: "connected",
        guild: { id: GUILD, name: "Acme" },
      });
      expect((await store.findProjectBySlug("shop"))?.discordGuildId).toBe(GUILD);
      expect(shop.discordGuildId).toBeNull();
    });

    it("replaces a previously connected guild and keeps the channel", async () => {
      await seedProject("shop", "RF", { discordGuildId: OTHER_GUILD, discordChannelId: GENERAL });
      await completeDiscordBotInstall(deps, "shop", "the-code");
      expect(await store.findProjectBySlug("shop")).toEqual(
        expect.objectContaining({ discordGuildId: GUILD, discordChannelId: GENERAL }),
      );
    });

    it("does not exchange the code for an unknown project", async () => {
      expect(await completeDiscordBotInstall(deps, "nope", "the-code")).toEqual({ status: "project_not_found" });
      expect(await completeDiscordBotInstall(deps, "Not A Slug", "the-code")).toEqual({ status: "project_not_found" });
      expect(discord.exchanged).toEqual([]);
    });

    it("throws without saving when Discord refuses the code", async () => {
      await seedProject("shop", "RF");
      await expect(completeDiscordBotInstall(deps, "shop", "bad-code")).rejects.toThrow();
      expect((await store.findProjectBySlug("shop"))?.discordGuildId).toBeNull();
    });

    it("throws without saving when the guild id is not a snowflake", async () => {
      await seedProject("shop", "RF");
      discord.codes.set("odd-code", { id: "42", name: "Tiny" });
      await expect(completeDiscordBotInstall(deps, "shop", "odd-code")).rejects.toThrow(/guild/);
      expect((await store.findProjectBySlug("shop"))?.discordGuildId).toBeNull();
    });
  });

  describe("listDiscordChannels", () => {
    it("lists the guild's text and announcement channels in order, marking those used by other projects", async () => {
      await seedProject("shop", "RF", { discordGuildId: GUILD, discordChannelId: GENERAL });
      await seedProject("blog", "BL", { discordChannelId: NEWS });

      expect(await listDiscordChannels(deps, "shop")).toEqual({
        status: "ok",
        guildId: GUILD,
        channels: [
          { id: GENERAL, name: "general", type: 0, usedBy: null },
          { id: NEWS, name: "news", type: 5, usedBy: { slug: "blog", name: "BLOG" } },
        ],
      });
    });

    it("answers project_not_found and discord_not_connected without calling Discord", async () => {
      await seedProject("shop", "RF");
      expect(await listDiscordChannels(deps, "nope")).toEqual({ status: "project_not_found" });
      expect(await listDiscordChannels(deps, "shop")).toEqual({ status: "discord_not_connected" });
      expect(discord.listed).toEqual([]);
    });

    it("lets Discord failures propagate", async () => {
      await seedProject("shop", "RF", { discordGuildId: OTHER_GUILD });
      await expect(listDiscordChannels(deps, "shop")).rejects.toThrow();
    });
  });

  describe("selectDiscordChannel", () => {
    beforeEach(async () => {
      await seedProject("shop", "RF", { discordGuildId: GUILD });
    });

    it("saves the channel, registers the commands in the guild and fills the invite", async () => {
      const result = await selectDiscordChannel(deps, "shop", { channelId: GENERAL });

      expect(result).toEqual({
        status: "saved",
        project: expect.objectContaining({
          discordGuildId: GUILD,
          discordChannelId: GENERAL,
          discordInviteUrl: `https://discord.gg/invite-${GENERAL}`,
        }),
        warnings: [],
      });
      expect(discord.registered).toEqual([GUILD]);
      expect(discord.invited).toEqual([GENERAL]);
      expect(await store.findProjectBySlug("shop")).toEqual(
        expect.objectContaining({ discordChannelId: GENERAL, discordInviteUrl: `https://discord.gg/invite-${GENERAL}` }),
      );
      expect(log).not.toHaveBeenCalled();
    });

    it("re-checks the channel against the guild's current channels", async () => {
      expect(await selectDiscordChannel(deps, "shop", { channelId: VOICE })).toEqual({ status: "channel_not_in_guild" });
      expect(await selectDiscordChannel(deps, "shop", { channelId: "999999999999999999" })).toEqual({
        status: "channel_not_in_guild",
      });
      expect((await store.findProjectBySlug("shop"))?.discordChannelId).toBeNull();
      expect(discord.registered).toEqual([]);
    });

    it("refuses a channel another project already posts to", async () => {
      await seedProject("blog", "BL", { discordChannelId: NEWS });
      expect(await selectDiscordChannel(deps, "shop", { channelId: NEWS })).toEqual({
        status: "channel_taken",
        project: { slug: "blog", name: "BLOG" },
      });
      expect((await store.findProjectBySlug("shop"))?.discordChannelId).toBeNull();
    });

    it("accepts the channel the project already has", async () => {
      await store.updateProject((await store.findProjectBySlug("shop"))!.id, { discordChannelId: GENERAL });
      expect(await selectDiscordChannel(deps, "shop", { channelId: GENERAL })).toEqual(
        expect.objectContaining({ status: "saved" }),
      );
    });

    it.each([[{}], [{ channelId: null }], [{ channelId: "abc" }], [{ channelId: 5 }], [null], ["x"], [[GENERAL]]])(
      "rejects %j as an invalid channel id",
      async (body) => {
        expect(await selectDiscordChannel(deps, "shop", body)).toEqual({ status: "invalid", field: "discordChannelId" });
        expect(discord.listed).toEqual([]);
      },
    );

    it("answers project_not_found and discord_not_connected", async () => {
      await seedProject("blog", "BL");
      expect(await selectDiscordChannel(deps, "nope", { channelId: GENERAL })).toEqual({ status: "project_not_found" });
      expect(await selectDiscordChannel(deps, "blog", { channelId: GENERAL })).toEqual({ status: "discord_not_connected" });
    });

    it("still saves the channel, with warnings, when registering commands or creating the invite fails", async () => {
      await store.updateProject((await store.findProjectBySlug("shop"))!.id, { discordInviteUrl: "https://discord.gg/old" });
      discord.failRegister = true;
      discord.failInvite = true;

      const result = await selectDiscordChannel(deps, "shop", { channelId: GENERAL });

      expect(result).toEqual({
        status: "saved",
        project: expect.objectContaining({ discordChannelId: GENERAL, discordInviteUrl: "https://discord.gg/old" }),
        warnings: ["commands_not_registered", "invite_not_created"],
      });
      expect(log).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(log.mock.calls)).toContain("register refused");
    });

    it("treats an invite code that does not make a valid invite link as a failed invite", async () => {
      discord.inviteCode = "bad code!";
      const result = await selectDiscordChannel(deps, "shop", { channelId: GENERAL });
      expect(result).toEqual(expect.objectContaining({ status: "saved", warnings: ["invite_not_created"] }));
    });

    it("lets a failure to list the guild's channels propagate without saving", async () => {
      discord.channels.delete(GUILD);
      await expect(selectDiscordChannel(deps, "shop", { channelId: GENERAL })).rejects.toThrow();
      expect((await store.findProjectBySlug("shop"))?.discordChannelId).toBeNull();
    });
  });
});
