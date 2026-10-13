import type { NotificationEvent, NotificationPublisher } from "../../src/application/notifications.ts";

/** {@link NotificationPublisher} that records every published event, in order. */
export class RecordingNotifications implements NotificationPublisher {
  events: NotificationEvent[] = [];
  /** How many times `publish` was called, even with no events. */
  publishCalls = 0;

  publish(events: readonly NotificationEvent[]): void {
    this.publishCalls += 1;
    this.events.push(...events);
  }
}
