import type { DiscordBotClient, DiscordGuild, DiscordGuildChannel } from "../../src/application/discord-bot-install.ts";

/**
 * In-memory {@link DiscordBotClient}: `codes` maps install codes to the guild Discord
 * would return, `channels` maps guild ids to their channels. Unknown codes and guilds
 * throw, like Discord's refusals. Every call is recorded.
 */
export class FakeDiscordBotClient implements DiscordBotClient {
  codes = new Map<string, DiscordGuild>();
  channels = new Map<string, DiscordGuildChannel[]>();
  /** Invite code returned by `createChannelInvite`; defaults to `invite-<channel id>`. */
  inviteCode: string | undefined;
  failRegister = false;
  failInvite = false;
  exchanged: string[] = [];
  listed: string[] = [];
  registered: string[] = [];
  invited: string[] = [];

  async exchangeBotInstallCode(code: string): Promise<DiscordGuild> {
    this.exchanged.push(code);
    const guild = this.codes.get(code);
    if (guild === undefined) throw new Error("Discord token exchange failed with status 400: invalid_grant");
    return guild;
  }

  async listGuildChannels(guildId: string): Promise<DiscordGuildChannel[]> {
    this.listed.push(guildId);
    const channels = this.channels.get(guildId);
    if (channels === undefined) throw new Error("Discord channel list failed with status 403");
    return channels;
  }

  async registerGuildCommands(guildId: string): Promise<void> {
    if (this.failRegister) throw new Error("Discord register refused with status 403");
    this.registered.push(guildId);
  }

  async createChannelInvite(channelId: string): Promise<string> {
    if (this.failInvite) throw new Error("Discord invite failed with status 403");
    this.invited.push(channelId);
    return this.inviteCode ?? `invite-${channelId}`;
  }
}
