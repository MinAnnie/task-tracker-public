import { describe, expect, it, vi } from "vitest";
import type { NotificationEvent } from "../application/notifications.ts";
import { createNotificationPublisher } from "./create-notification-publisher.ts";

const event: NotificationEvent = {
  type: "task_unblocked",
  channelId: "123",
  projectSlug: "shop",
  task: { key: "RF-1", title: "Checkout" },
  assigneeLogin: null,
};

describe("createNotificationPublisher", () => {
  it("is disabled without a bot token: logs one line and never calls Discord", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const info = vi.fn();

    const publisher = createNotificationPublisher({
      discordBotToken: undefined,
      appBaseUrl: "https://tasks.example.com",
      fetch,
      info,
      log: vi.fn(),
    });
    publisher.publish([event]);
    await publisher.flush();

    expect(fetch).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0])).toContain("DISCORD_BOT_TOKEN");
  });

  it("delivers to Discord in the background when a bot token is set, without logging it", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    const info = vi.fn();

    const publisher = createNotificationPublisher({
      discordBotToken: "bot-secret",
      appBaseUrl: "https://tasks.example.com",
      fetch,
      info,
      log: vi.fn(),
    });
    publisher.publish([event]);
    await publisher.flush();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe("https://discord.com/api/v10/channels/123/messages");
    expect(JSON.stringify(info.mock.calls)).not.toContain("bot-secret");
  });
});
