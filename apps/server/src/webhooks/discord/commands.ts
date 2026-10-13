/**
 * The Discord slash commands: the single source of truth for both the registration
 * script (which uploads these definitions) and the interaction handler.
 *
 * @see https://discord.com/developers/docs/interactions/application-commands
 */

/** `CHAT_INPUT`: a slash command. */
const CHAT_INPUT = 1;
/** Option type `STRING`. */
const STRING = 3;
/** Interaction context `GUILD`: projects are found by channel, so DMs make no sense. */
const GUILD = 0;

export const COMMAND_NAMES = ["tasks", "mine", "task", "take", "release"] as const;
export type CommandName = (typeof COMMAND_NAMES)[number];

/** Name of the task key option of `/task`, `/take` and `/release`. */
export const KEY_OPTION = "key";

export interface DiscordCommandOption {
  type: typeof STRING;
  name: string;
  description: string;
  required: boolean;
  autocomplete: boolean;
}

export interface DiscordCommandDefinition {
  type: typeof CHAT_INPUT;
  name: CommandName;
  description: string;
  contexts: (typeof GUILD)[];
  options: DiscordCommandOption[];
}

const keyOption = (description: string): DiscordCommandOption => ({
  type: STRING,
  name: KEY_OPTION,
  description,
  required: true,
  autocomplete: true,
});

const command = (
  name: CommandName,
  description: string,
  options: DiscordCommandOption[] = [],
): DiscordCommandDefinition => ({ type: CHAT_INPUT, name, description, contexts: [GUILD], options });

export const DISCORD_COMMANDS: readonly DiscordCommandDefinition[] = [
  command("tasks", "Tasks you can take now in this channel's project"),
  command("mine", "Your unfinished tasks in this channel's project"),
  command("task", "Show a task", [keyOption("Task key, e.g. RF-14")]),
  command("take", "Take a task", [keyOption("Task key, e.g. RF-14")]),
  command("release", "Release a task you have taken", [keyOption("Task key, e.g. RF-14")]),
];
