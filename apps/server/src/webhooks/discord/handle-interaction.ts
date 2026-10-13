import type { DiscordCallerResult } from "../../application/discord-caller.ts";
import type { AuthenticatedUser } from "../../application/sessions.ts";
import type {
  BoardTask,
  GetTaskResult,
  ListTasksResult,
  ReleaseTaskResult,
  TakeTaskResult,
} from "../../application/tasks.ts";
import type { TaskStatus } from "../../domain/index.ts";
import {
  DISCORD_MESSAGE_LIMIT,
  escapeDiscordMarkdown,
  PRIORITY_LABELS,
  taskUrl,
} from "../../infrastructure/discord-message.ts";
import { KEY_OPTION, type CommandName } from "./commands.ts";

/**
 * Use cases behind the slash commands. They are the web's own task use cases, so
 * access, dependency and race rules (and notifications) are identical.
 */
export interface DiscordInteractionDeps {
  /** Public origin of the web app, for links. */
  appBaseUrl: string;
  resolveCaller: (discordUserId: string, channelId: string) => Promise<DiscordCallerResult>;
  listTasks: (user: AuthenticatedUser, slug: string) => Promise<ListTasksResult>;
  getTask: (user: AuthenticatedUser, slug: string, key: string) => Promise<GetTaskResult>;
  takeTask: (user: AuthenticatedUser, slug: string, key: string) => Promise<TakeTaskResult>;
  releaseTask: (user: AuthenticatedUser, slug: string, key: string) => Promise<ReleaseTaskResult>;
}

/** Interaction types we receive. @see https://discord.com/developers/docs/interactions/receiving-and-responding */
const PING = 1;
const APPLICATION_COMMAND = 2;
const APPLICATION_COMMAND_AUTOCOMPLETE = 4;

/** Interaction callback types we answer with. */
const PONG = 1;
const CHANNEL_MESSAGE_WITH_SOURCE = 4;
const APPLICATION_COMMAND_AUTOCOMPLETE_RESULT = 8;

/** Message flag: only the invoking user sees the reply. */
const EPHEMERAL = 64;
const MAX_LISTED_TASKS = 15;
const MAX_CHOICES = 25;
const CHOICE_NAME_LIMIT = 100;
/** Titles in replies are shortened to this many characters. */
const TITLE_LIMIT = 80;
const KEY_ECHO_LIMIT = 40;

export type DiscordInteractionResponse =
  | { type: typeof PONG }
  | {
      type: typeof CHANNEL_MESSAGE_WITH_SOURCE;
      data: { content: string; flags: typeof EPHEMERAL; allowed_mentions: { parse: [] } };
    }
  | { type: typeof APPLICATION_COMMAND_AUTOCOMPLETE_RESULT; data: { choices: { name: string; value: string }[] } };

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  blocked: "Blocked",
  done: "Done",
};
/** Order of the groups in `/mine`. */
const MINE_STATUSES: readonly TaskStatus[] = ["in_progress", "in_review", "blocked", "todo"];

/** The parts of an interaction payload the handler reads. */
interface Interaction {
  type: unknown;
  commandName: string | undefined;
  key: string | undefined;
  discordUserId: string | undefined;
  channelId: string | undefined;
}

type Caller = Extract<DiscordCallerResult, { status: "ok" }>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

function parseInteraction(payload: unknown): Interaction {
  const body = isObject(payload) ? payload : {};
  const data = isObject(body.data) ? body.data : {};
  const options = Array.isArray(data.options) ? data.options.filter(isObject) : [];
  const keyOption = options.find((option) => option.name === KEY_OPTION);
  // In guilds the invoking user is `member.user`; in DMs it is `user`.
  const member = isObject(body.member) ? body.member : {};
  const invoker = isObject(member.user) ? member.user : isObject(body.user) ? body.user : {};
  return {
    type: body.type,
    commandName: str(data.name),
    key: str(keyOption?.value)?.trim(),
    discordUserId: str(invoker.id),
    channelId: str(body.channel_id),
  };
}

const reply = (content: string): DiscordInteractionResponse => ({
  type: CHANNEL_MESSAGE_WITH_SOURCE,
  data: { content: fit(content), flags: EPHEMERAL, allowed_mentions: { parse: [] } },
});

/** Last-resort cap on Discord's message length; lists already budget their lines. */
function fit(content: string): string {
  return content.length <= DISCORD_MESSAGE_LIMIT ? content : `${content.slice(0, DISCORD_MESSAGE_LIMIT - 1)}…`;
}

/** Shortens by code points (so emoji stay whole). */
function shorten(text: string, limit: number): string {
  const chars = [...text];
  return chars.length > limit ? `${chars.slice(0, limit - 1).join("")}…` : text;
}

const escaped = (text: string, limit = TITLE_LIMIT) => escapeDiscordMarkdown(shorten(text, limit));

/** Task keys come from the database in `PREFIX-n` form, so they are safe in code spans. */
const code = (key: string) => `\`${key}\``;

const UNKNOWN_COMMAND = reply("Unknown command.");

/**
 * Handles a verified Discord interaction: PING, slash commands and key autocomplete.
 * Every reply is ephemeral and never mentions anyone.
 */
export function createDiscordInteractionHandler(deps: DiscordInteractionDeps) {
  const link = (slug: string, key: string) => `<${taskUrl(deps.appBaseUrl, slug, key)}>`;

  const taskLine = ({ project }: Caller, task: BoardTask) =>
    `${code(task.key)} ${escaped(task.title)} · ${PRIORITY_LABELS[task.priority]} — ${link(project.slug, task.key)}`;

  const notPartOf = ({ project }: Caller) => reply(`You're not part of ${escaped(project.name)}.`);
  const notLinked = () => reply("This channel isn't linked to a project. An admin can set it in the project settings.");
  const noSuchTask = ({ project }: Caller, key: string) =>
    reply(`There's no task ${escaped(key, KEY_ECHO_LIMIT)} in ${escaped(project.name)}.`);

  /** Failures every task use case shares. */
  const commonFailure = (caller: Caller, key: string, status: string) => {
    if (status === "forbidden") return notPartOf(caller);
    // The channel's project vanished between resolving and using it.
    if (status === "project_not_found") return notLinked();
    if (status === "task_not_found") return noSuchTask(caller, key);
    return undefined;
  };

  /** Lines that fit Discord's limit after `header`, ending with "…and N more." when some are left out. */
  function list(header: string, lines: readonly string[]): string {
    const rest = (n: number) => `…and ${n} more.`;
    const shown: string[] = [];
    let length = header.length;
    for (const [index, line] of lines.entries()) {
      if (shown.length === MAX_LISTED_TASKS) break;
      const remaining = lines.length - index - 1;
      const reserve = remaining > 0 ? rest(lines.length).length + 1 : 0;
      if (length + 1 + line.length + reserve > DISCORD_MESSAGE_LIMIT) break;
      shown.push(line);
      length += 1 + line.length;
    }
    const hidden = lines.length - shown.length;
    return [header, ...shown, ...(hidden > 0 ? [rest(hidden)] : [])].join("\n");
  }

  const isMine = (caller: Caller, task: BoardTask) =>
    task.assignee?.login.toLowerCase() === caller.user.githubLogin.toLowerCase();

  async function tasks(caller: Caller) {
    const result = await deps.listTasks(caller.user, caller.project.slug);
    if (result.status !== "ok") return commonFailure(caller, "", result.status) ?? UNKNOWN_COMMAND;
    const available = result.tasks.filter((task) => task.canTake);
    const name = escaped(caller.project.name);
    if (available.length === 0) return reply(`Nothing to take in ${name} right now.`);
    return reply(
      list(
        `**Tasks you can take in ${name}** (${available.length})`,
        available.map((task) => taskLine(caller, task)),
      ),
    );
  }

  async function mine(caller: Caller) {
    const result = await deps.listTasks(caller.user, caller.project.slug);
    if (result.status !== "ok") return commonFailure(caller, "", result.status) ?? UNKNOWN_COMMAND;
    const own = result.tasks.filter((task) => isMine(caller, task) && task.status !== "done");
    const name = escaped(caller.project.name);
    if (own.length === 0) return reply(`You have no unfinished tasks in ${name}.`);
    const lines = MINE_STATUSES.flatMap((status) => {
      const group = own.filter((task) => task.status === status);
      return group.length === 0 ? [] : [`**${STATUS_LABELS[status]}**`, ...group.map((t) => taskLine(caller, t))];
    });
    return reply(list(`**Your tasks in ${name}**`, lines));
  }

  async function task(caller: Caller, key: string) {
    const result = await deps.getTask(caller.user, caller.project.slug, key);
    if (result.status !== "ok") return commonFailure(caller, key, result.status) ?? UNKNOWN_COMMAND;
    const { task: detail } = result;
    const assignee = detail.assignee ? escaped(detail.assignee.login) : "nobody";
    return reply(
      [
        `${code(detail.key)} ${escaped(detail.title)}`,
        `Status: ${STATUS_LABELS[detail.status]} · Priority: ${PRIORITY_LABELS[detail.priority]} · Assignee: ${assignee}`,
        ...(detail.pendingDependencies.length > 0
          ? [`Waiting on: ${detail.pendingDependencies.map(code).join(", ")}`]
          : []),
        link(caller.project.slug, detail.key),
      ].join("\n"),
    );
  }

  /** The current assignee of a task, for refusal messages; `undefined` when unknown. */
  async function assigneeOf(caller: Caller, key: string) {
    const result = await deps.getTask(caller.user, caller.project.slug, key);
    return result.status === "ok" ? result.task : undefined;
  }

  async function take(caller: Caller, key: string) {
    const result = await deps.takeTask(caller.user, caller.project.slug, key);
    switch (result.status) {
      case "ok":
        return reply(
          `You took ${code(result.task.key)} ${escaped(result.task.title)}. — ${link(caller.project.slug, result.task.key)}`,
        );
      case "task_taken": {
        const current = await assigneeOf(caller, key);
        const shownKey = current ? code(current.key) : escaped(key, KEY_ECHO_LIMIT);
        if (current?.assignee == null) return reply(`${shownKey} was just taken by someone else.`);
        if (current.assignee.login.toLowerCase() === caller.user.githubLogin.toLowerCase()) {
          return reply(`You already have ${shownKey}.`);
        }
        return reply(`${shownKey} is already taken by ${escaped(current.assignee.login)}.`);
      }
      case "dependencies_pending": {
        const current = await assigneeOf(caller, key);
        const shownKey = current ? code(current.key) : escaped(key, KEY_ECHO_LIMIT);
        return reply(
          `${shownKey} is waiting on ${result.pendingDependencies.map(code).join(", ")}. Those need to be done first.`,
        );
      }
      case "task_done": {
        const current = await assigneeOf(caller, key);
        return reply(`${current ? code(current.key) : escaped(key, KEY_ECHO_LIMIT)} is already done.`);
      }
      default:
        return commonFailure(caller, key, result.status) ?? UNKNOWN_COMMAND;
    }
  }

  async function release(caller: Caller, key: string) {
    const result = await deps.releaseTask(caller.user, caller.project.slug, key);
    switch (result.status) {
      case "ok":
        return reply(`You released ${code(result.task.key)} ${escaped(result.task.title)}.`);
      case "task_not_assigned": {
        const current = await assigneeOf(caller, key);
        return reply(`${current ? code(current.key) : escaped(key, KEY_ECHO_LIMIT)} isn't assigned to anyone.`);
      }
      case "forbidden": {
        // Forbidden means either "not in the project" or "not the assignee"; reading
        // the task (same access rule) tells them apart.
        const current = await assigneeOf(caller, key);
        if (current === undefined) return notPartOf(caller);
        const who = current.assignee ? `${escaped(current.assignee.login)} (the assignee)` : "the assignee";
        return reply(`Only ${who} or an admin can release ${code(current.key)}.`);
      }
      default:
        return commonFailure(caller, key, result.status) ?? UNKNOWN_COMMAND;
    }
  }

  async function runCommand(interaction: Interaction): Promise<DiscordInteractionResponse> {
    const name = interaction.commandName as CommandName | undefined;
    if (!name || !["tasks", "mine", "task", "take", "release"].includes(name)) return UNKNOWN_COMMAND;
    if (interaction.discordUserId === undefined || interaction.channelId === undefined) return UNKNOWN_COMMAND;

    const caller = await deps.resolveCaller(interaction.discordUserId, interaction.channelId);
    switch (caller.status) {
      case "not_linked":
        return reply(
          `Connect your Discord account first: ${deps.appBaseUrl} (account menu → Connect Discord), then try again.`,
        );
      case "no_access":
        return reply("You don't have access to Task Tracker.");
      case "channel_not_linked":
        return notLinked();
    }

    if (name === "tasks") return tasks(caller);
    if (name === "mine") return mine(caller);
    const key = interaction.key;
    if (!key) return reply(`Give a task key, e.g. \`/${name} key:RF-14\`.`);
    if (name === "task") return task(caller, key);
    if (name === "take") return take(caller, key);
    return release(caller, key);
  }

  async function suggest(interaction: Interaction): Promise<DiscordInteractionResponse> {
    const none: DiscordInteractionResponse = { type: APPLICATION_COMMAND_AUTOCOMPLETE_RESULT, data: { choices: [] } };
    const name = interaction.commandName;
    if (interaction.discordUserId === undefined || interaction.channelId === undefined) return none;
    if (name !== "task" && name !== "take" && name !== "release") return none;

    const caller = await deps.resolveCaller(interaction.discordUserId, interaction.channelId);
    if (caller.status !== "ok") return none;
    const result = await deps.listTasks(caller.user, caller.project.slug);
    if (result.status !== "ok") return none;

    const typed = (interaction.key ?? "").toLowerCase();
    const relevant = (task: BoardTask) =>
      name === "take" ? task.canTake : name === "release" ? isMine(caller, task) : true;
    const matches = (task: BoardTask) =>
      task.key.toLowerCase().startsWith(typed) || task.title.toLowerCase().includes(typed);
    const choices = result.tasks
      .filter((task) => relevant(task) && matches(task))
      .slice(0, MAX_CHOICES)
      .map((task) => ({ name: shorten(`${task.key} ${task.title}`.replace(/\s+/g, " "), CHOICE_NAME_LIMIT), value: task.key }));
    return { type: APPLICATION_COMMAND_AUTOCOMPLETE_RESULT, data: { choices } };
  }

  return async (payload: unknown): Promise<DiscordInteractionResponse> => {
    const interaction = parseInteraction(payload);
    switch (interaction.type) {
      case PING:
        return { type: PONG };
      case APPLICATION_COMMAND:
        return runCommand(interaction);
      case APPLICATION_COMMAND_AUTOCOMPLETE:
        return suggest(interaction);
      default:
        return UNKNOWN_COMMAND;
    }
  };
}
