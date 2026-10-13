import type { NotificationEvent, NotificationPublisher, Notifier } from "./notifications.ts";

export interface NotificationDispatcherOptions {
  notifier: Notifier;
  /** Events waiting or in flight beyond this are dropped (and logged). */
  maxPending?: number;
  log?: (...args: unknown[]) => void;
}

export interface NotificationDispatcher extends NotificationPublisher {
  /** Resolves once every event published so far was handled (delivered, failed or dropped). */
  flush(): Promise<void>;
}

/**
 * Background {@link NotificationPublisher}: `publish` returns right away and events
 * are handed to the notifier one at a time, in publish order, through a bounded queue.
 * Notifier failures are logged and never reach the publisher.
 */
export function createNotificationDispatcher({
  notifier,
  maxPending = 100,
  log = console.error,
}: NotificationDispatcherOptions): NotificationDispatcher {
  let pending = 0;
  let tail: Promise<void> = Promise.resolve();

  const deliver = async (event: NotificationEvent) => {
    try {
      await notifier.notify(event);
    } catch (error) {
      log(`Notification ${event.type} failed:`, error);
    } finally {
      pending -= 1;
    }
  };

  return {
    publish(events) {
      for (const event of events) {
        if (pending >= maxPending) {
          log(`Notification ${event.type} dropped: ${pending} notifications already pending`);
          continue;
        }
        pending += 1;
        tail = tail.then(() => deliver(event));
      }
    },

    async flush() {
      let current: Promise<void>;
      do {
        current = tail;
        await current;
      } while (current !== tail);
    },
  };
}
