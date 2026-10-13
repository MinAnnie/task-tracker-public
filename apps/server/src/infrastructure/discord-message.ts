import type { NotificationEvent } from "../application/notifications.ts";
import { isDiscordUserId, type TaskPriority } from "../domain/index.ts";

/** Discord rejects message content longer than this. */
export const DISCORD_MESSAGE_LIMIT = 2000;
/** User-provided fields (titles, branches, logins) are shortened to this many characters. */
const FIELD_LIMIT = 200;
/** Task keys listed for a pull request before summarizing the rest. */
const MAX_LISTED_KEYS = 20;

/** Characters Discord interprets as markdown, mentions, masked links or headings. */
const MARKDOWN_CHARACTERS = /[\\*_~`|>#\-[\]()<@]/g;

/** Makes user text render literally on one line: no formatting, links or mentions. */
export function escapeDiscordMarkdown(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").replace(MARKDOWN_CHARACTERS, "\\$&");
}

/** Shortens (by code points, so emoji stay whole) and escapes user-provided text. */
function field(text: string): string {
  const chars = [...text];
  const short = chars.length > FIELD_LIMIT ? `${chars.slice(0, FIELD_LIMIT - 1).join("")}…` : text;
  return escapeDiscordMarkdown(short);
}

function listKeys(keys: readonly string[]): string {
  const listed = keys.slice(0, MAX_LISTED_KEYS).join(", ");
  const rest = keys.length - MAX_LISTED_KEYS;
  return rest > 0 ? `${listed} and ${rest} more` : listed;
}

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Task keys come from the database in `PREFIX-n` form, so they are safe in code spans. */
const code = (key: string) => `\`${key}\``;

/** `<url>` links without an embed preview. */
const link = (url: string) => `<${url}>`;

/**
 * The assignee as a `<@id>` mention when their linked Discord id is a valid snowflake,
 * else their escaped login. Only ids read from the database reach here; the check keeps
 * anything else from turning into a mention. Whether it pings is up to `allowed_mentions`.
 */
function assignee(login: string, discordUserId: string | null): string {
  return isDiscordUserId(discordUserId) ? `<@${discordUserId}>` : field(login);
}

export function boardUrl(appBaseUrl: string, projectSlug: string): string {
  // Mirrors the web app's board route (`paths.board` in apps/web/src/lib/paths.ts).
  return `${appBaseUrl}/projects/${encodeURIComponent(projectSlug)}`;
}

export function taskUrl(appBaseUrl: string, projectSlug: string, key: string): string {
  // Mirrors the web app's task detail route (`paths.task` in apps/web/src/lib/paths.ts).
  return `${boardUrl(appBaseUrl, projectSlug)}/tasks/${encodeURIComponent(key)}`;
}

/** One-line Discord message (at most {@link DISCORD_MESSAGE_LIMIT} characters) for an event. */
export function formatDiscordMessage(event: NotificationEvent, appBaseUrl: string): string {
  return truncate(compose(event, appBaseUrl));
}

function compose(event: NotificationEvent, appBaseUrl: string): string {
  if (event.type === "pull_request") {
    const { number, title, branch, url, authorLogin } = event.pullRequest;
    const tasks = listKeys(event.taskKeys);
    if (event.action === "merged") {
      return `✅ PR #${number} ${field(title)} by ${field(authorLogin)} was merged for ${tasks} — ${link(url)}`;
    }
    return `🔀 ${field(authorLogin)} ${event.action} PR #${number} ${field(title)} (${field(branch)}) for ${tasks} — ${link(url)}`;
  }
  if (event.type === "tasks_imported") {
    const tasks = event.count === 1 ? "1 task" : `${event.count} tasks`;
    const board = link(boardUrl(appBaseUrl, event.projectSlug));
    const done = event.doneCount > 0 ? `, ${event.doneCount} already done` : "";
    return `📥 Imported ${tasks} into ${field(event.projectSlug)} (${event.explicitKeyCount} with explicit keys${done}). Board: ${board}`;
  }

  const task = `${event.task.key} ${field(event.task.title)}`;
  const taskLink = link(taskUrl(appBaseUrl, event.projectSlug, event.task.key));
  switch (event.type) {
    case "task_created": {
      const urgent = event.priority === "urgent" ? "🔥 **URGENT** " : "";
      const assignedTo =
        event.assigneeLogin === null ? "" : ` · assigned to ${assignee(event.assigneeLogin, event.assigneeDiscordUserId)}`;
      return `🆕 ${urgent}${code(event.task.key)} ${field(event.task.title)} · ${PRIORITY_LABELS[event.priority]} · by ${field(event.actorLogin)}${assignedTo} — ${taskLink}`;
    }
    case "task_taken": {
      const who = assignee(event.assigneeLogin, event.assigneeDiscordUserId);
      const codeTask = `${code(event.task.key)} ${field(event.task.title)}`;
      return event.actorLogin.toLowerCase() === event.assigneeLogin.toLowerCase()
        ? `✋ ${who} took ${codeTask} — ${taskLink}`
        : `📌 ${who} was assigned ${codeTask} by ${field(event.actorLogin)} — ${taskLink}`;
    }
    case "task_unblocked":
      return event.assigneeLogin === null
        ? `🔓 ${task} is now available to take. — ${taskLink}`
        : `🔓 ${task} is unblocked (assigned to ${field(event.assigneeLogin)}). — ${taskLink}`;
  }
}

/** Last-resort cap; fields are already shortened, so this only trims pathological input. */
function truncate(message: string): string {
  if (message.length <= DISCORD_MESSAGE_LIMIT) return message;
  const chars = [...message];
  let cut = chars.slice(0, DISCORD_MESSAGE_LIMIT - 1).join("");
  while (cut.length > DISCORD_MESSAGE_LIMIT - 1) cut = [...cut].slice(0, -1).join("");
  // A dangling escape backslash would escape the ellipsis instead.
  return `${cut.replace(/\\$/, "")}…`;
}
