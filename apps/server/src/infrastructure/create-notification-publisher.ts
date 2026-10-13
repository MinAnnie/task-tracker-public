import {
  createNotificationDispatcher,
  type NotificationDispatcher,
} from "../application/notification-dispatcher.ts";
import { noNotifications } from "../application/notifications.ts";
import { createDiscordNotifier } from "./discord-notifier.ts";

export interface NotificationPublisherOptions {
  /** When unset, notifications are disabled. */
  discordBotToken: string | undefined;
  appBaseUrl: string;
  fetch?: typeof globalThis.fetch;
  /** Startup status line. */
  info?: (message: string) => void;
  /** Delivery failures. */
  log?: (...args: unknown[]) => void;
}

/**
 * The app's notification publisher: Discord deliveries in the background when a bot
 * token is configured, otherwise a no-op. Logs which one it is, never the token.
 */
export function createNotificationPublisher({
  discordBotToken,
  appBaseUrl,
  fetch,
  info = console.log,
  log = console.error,
}: NotificationPublisherOptions): NotificationDispatcher {
  if (discordBotToken === undefined) {
    info("Discord notifications disabled (DISCORD_BOT_TOKEN is not set).");
    return { ...noNotifications, flush: async () => {} };
  }
  info("Discord notifications enabled.");
  const notifier = createDiscordNotifier({ botToken: discordBotToken, appBaseUrl, fetch, log });
  return createNotificationDispatcher({ notifier, log });
}
