import type { NotificationEvent, Notifier } from "../application/notifications.ts";
import { isDiscordUserId } from "../domain/index.ts";
import { formatDiscordMessage } from "./discord-message.ts";

const API_BASE = "https://discord.com/api/v10";
/** Discord asks bots to identify themselves with this User-Agent shape. */
export const USER_AGENT = "DiscordBot (https://github.com/task-tracker, 1.0)";
const TIMEOUT_MS = 5_000;
const MAX_RETRY_WAIT_MS = 5_000;

export interface DiscordNotifierOptions {
  botToken: string;
  /** Public origin of the web app, for task links. */
  appBaseUrl: string;
  fetch?: typeof globalThis.fetch;
  log?: (...args: unknown[]) => void;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * {@link Notifier} posting one message per event to the event's Discord channel through
 * the REST API (no gateway connection). Mentions are disabled, so user text can never
 * ping anyone; the only exception is the assignee of an event asking to `ping` them. A 429 is retried once after `retry_after` (capped); any other failure is
 * logged and dropped. It never throws and never logs the bot token.
 */
export function createDiscordNotifier({
  botToken,
  appBaseUrl,
  fetch = globalThis.fetch,
  log = console.error,
  sleep = defaultSleep,
}: DiscordNotifierOptions): Notifier {
  const post = (event: NotificationEvent, content: string) =>
    fetch(`${API_BASE}/channels/${encodeURIComponent(event.channelId)}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bot ${botToken}`,
        "content-type": "application/json",
        "user-agent": USER_AGENT,
      },
      body: JSON.stringify({ content, allowed_mentions: allowedMentions(event) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  return {
    async notify(event) {
      const content = formatDiscordMessage(event, appBaseUrl);
      const where = `Discord notification ${event.type} to channel ${event.channelId}`;
      try {
        let res = await post(event, content);
        if (res.status === 429) {
          await sleep(await retryDelayMs(res));
          res = await post(event, content);
        }
        if (!res.ok) log(`${where} failed with status ${res.status}`);
      } catch (error) {
        log(`${where} failed: ${describeError(error)}`);
      }
    },
  };
}

/**
 * At most the event's assignee may be pinged, and only when the event asks for it and
 * the id is a snowflake. Discord forbids `parse` next to `users`, so the two never mix.
 */
function allowedMentions(event: NotificationEvent): { parse: [] } | { users: [string] } {
  if ((event.type === "task_taken" || event.type === "task_created") && event.ping) {
    const id = event.assigneeDiscordUserId;
    if (isDiscordUserId(id)) return { users: [id] };
  }
  return { parse: [] };
}

/** Milliseconds to wait before retrying a 429: `retry_after` (seconds) from the body, else the header. */
async function retryDelayMs(res: Response): Promise<number> {
  let seconds = Number(res.headers.get("retry-after"));
  try {
    const body = (await res.json()) as { retry_after?: unknown };
    if (typeof body.retry_after === "number") seconds = body.retry_after;
  } catch {
    // Not JSON: keep the header value.
  }
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  return Math.min(Math.round(seconds * 1000), MAX_RETRY_WAIT_MS);
}

/** Error name and message only: request details (and the token) stay out of the logs. */
function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
