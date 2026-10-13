import { describe, expect, it, vi } from "vitest";
import { createNotificationDispatcher } from "./notification-dispatcher.ts";
import type { NotificationEvent, Notifier } from "./notifications.ts";

const unblocked = (key: string): NotificationEvent => ({
  type: "task_unblocked",
  channelId: "123",
  projectSlug: "shop",
  task: { key, title: `Task ${key}` },
  assigneeLogin: null,
});

/** A notifier whose deliveries stay pending until the test resolves them. */
function controlledNotifier() {
  const delivered: string[] = [];
  const resolvers: (() => void)[] = [];
  const notifier: Notifier = {
    notify: (event) =>
      new Promise<void>((resolve) => {
        resolvers.push(() => {
          if (event.type === "task_unblocked") delivered.push(event.task.key);
          resolve();
        });
      }),
  };
  const release = async () => {
    // Deliveries are sequential: wait for the next one to start, then finish it.
    await vi.waitFor(() => expect(resolvers.length).toBeGreaterThan(0));
    resolvers.shift()!();
  };
  return { notifier, delivered, release, started: () => resolvers.length };
}

describe("createNotificationDispatcher", () => {
  it("returns before the notifier finishes and delivers on flush", async () => {
    const delivered: NotificationEvent[] = [];
    let finish!: () => void;
    const notifier: Notifier = {
      notify: (event) =>
        new Promise<void>((resolve) => {
          finish = () => {
            delivered.push(event);
            resolve();
          };
        }),
    };
    const dispatcher = createNotificationDispatcher({ notifier, log: vi.fn() });

    const returned = dispatcher.publish([unblocked("RF-1")]);

    expect(returned).toBeUndefined();
    expect(delivered).toEqual([]);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    finish();
    await dispatcher.flush();
    expect(delivered).toEqual([unblocked("RF-1")]);
  });

  it("delivers events one at a time, in publish order", async () => {
    const { notifier, delivered, release, started } = controlledNotifier();
    const dispatcher = createNotificationDispatcher({ notifier, log: vi.fn() });

    dispatcher.publish([unblocked("RF-1"), unblocked("RF-2")]);
    dispatcher.publish([unblocked("RF-3")]);

    await vi.waitFor(() => expect(started()).toBe(1));
    await release();
    await release();
    await release();
    await dispatcher.flush();
    expect(delivered).toEqual(["RF-1", "RF-2", "RF-3"]);
  });

  it("logs notifier failures, sync or async, and keeps delivering", async () => {
    const log = vi.fn();
    const notify = vi
      .fn<Notifier["notify"]>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementationOnce(() => {
        throw new Error("sync boom");
      })
      .mockResolvedValue(undefined);
    const dispatcher = createNotificationDispatcher({ notifier: { notify }, log });

    expect(() => dispatcher.publish([unblocked("RF-1"), unblocked("RF-2"), unblocked("RF-3")])).not.toThrow();
    await dispatcher.flush();

    expect(notify).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledTimes(2);
    expect(String(log.mock.calls[0])).toContain("task_unblocked");
  });

  it("drops events beyond the pending limit instead of queueing without bound", async () => {
    const { notifier, delivered, release } = controlledNotifier();
    const log = vi.fn();
    const dispatcher = createNotificationDispatcher({ notifier, log, maxPending: 2 });

    dispatcher.publish([unblocked("RF-1"), unblocked("RF-2"), unblocked("RF-3")]);

    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0])).toContain("dropped");
    await release();
    await release();
    await dispatcher.flush();
    expect(delivered).toEqual(["RF-1", "RF-2"]);

    // Capacity frees up once deliveries finish.
    dispatcher.publish([unblocked("RF-4")]);
    await release();
    await dispatcher.flush();
    expect(delivered).toEqual(["RF-1", "RF-2", "RF-4"]);
  });

  it("flush resolves immediately when nothing was published", async () => {
    const dispatcher = createNotificationDispatcher({ notifier: { notify: vi.fn() }, log: vi.fn() });
    await expect(dispatcher.flush()).resolves.toBeUndefined();
  });
});
