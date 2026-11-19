/** A channel of a Discord server, as the bot sees it. */
export interface DiscordChannel {
  id: string;
  name: string;
  /** Discord channel type: 0 text, 2 voice, 4 category, 5 announcement, … */
  type: number;
  /** Sort position within the server's channel list. */
  position: number;
}

/** Channel types the bot can post notifications to: text (0) and announcement (5). */
const POSTABLE_TYPES: readonly number[] = [0, 5];

/** The channels a project can post to, in the server's order (position, then name). */
export function selectableDiscordChannels<T extends DiscordChannel>(channels: readonly T[]): T[] {
  return channels
    .filter((channel) => POSTABLE_TYPES.includes(channel.type))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}
