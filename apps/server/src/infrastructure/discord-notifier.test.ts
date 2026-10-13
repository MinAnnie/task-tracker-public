import { describe, expect, it, vi } from "vitest";
import type { NotificationEvent } from "../application/notifications.ts";
import { createDiscordNotifier } from "./discord-notifier.ts";

const TOKEN = "secret-bot-token";
const event: NotificationEvent = {
  type: "task_created",
  channelId: "112233",
  projectSlug: "shop",
  task: { key: "RF-1", title: "@everyone *fix* prod" },
  priority: "urgent",
  actorLogin: "mona",
  assigneeLogin: null,
  assigneeDiscordUserId: null,
  ping: false,
};
const BOB_DISCORD = "123456789012345678";
const assigned = (ping: boolean, assigneeDiscordUserId: string | null = BOB_DISCORD): NotificationEvent => ({
  type: "task_taken",
  channelId: "112233",
  projectSlug: "shop",
  task: { key: "RF-1", title: "@everyone fix" },
  assigneeLogin: "bob",
  assigneeDiscordUserId,
  ping,
  actorLogin: "octocat",
});
const sentBody = (fetch: ReturnType<typeof setup>["fetch"], call = 0) =>
  JSON.parse(String(fetch.mock.calls[call]![1]?.body)) as { content: string; allowed_mentions: unknown };

const json = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function setup(...responses: (Response | Error)[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) {
    if (response instanceof Error) fetch.mockRejectedValueOnce(response);
    else fetch.mockResolvedValueOnce(response);
  }
  const log = vi.fn();
  const sleep = vi.fn(async (_ms: number) => {});
  const notifier = createDiscordNotifier({
    botToken: TOKEN,
    appBaseUrl: "https://tasks.example.com",
    fetch,
    log,
    sleep,
  });
  return { notifier, fetch, log, sleep };
}

const loggedText = (log: ReturnType<typeof vi.fn>) => JSON.stringify(log.mock.calls.map((c) => c.map(String)));

describe("createDiscordNotifier", () => {
  it("allows pinging exactly the assignee when the event asks for it", async () => {
    const { notifier, fetch } = setup(json(200));

    await notifier.notify(assigned(true));

    expect(sentBody(fetch)).toEqual({
      content: `📌 <@${BOB_DISCORD}> was assigned \`RF-1\` \\@everyone fix by octocat — <https://tasks.example.com/projects/shop/tasks/RF-1>`,
      allowed_mentions: { users: [BOB_DISCORD] },
    });
  });

  it("disables every mention when the event does not ask to ping", async () => {
    const { notifier, fetch } = setup(json(200));

    await notifier.notify(assigned(false));

    expect(sentBody(fetch)).toEqual({
      content: expect.stringContaining(`<@${BOB_DISCORD}>`),
      allowed_mentions: { parse: [] },
    });
  });

  it("never pings an id that is not a Discord snowflake, nor events without an assignee mention", async () => {
    const { notifier, fetch } = setup(json(200), json(200), json(200));

    await notifier.notify(assigned(true, null));
    await notifier.notify(assigned(true, "everyone"));
    await notifier.notify({ type: "task_unblocked", channelId: "1", projectSlug: "shop", task: { key: "RF-1", title: "t" }, assigneeLogin: "bob" });

    for (const call of [0, 1, 2]) expect(sentBody(fetch, call).allowed_mentions).toEqual({ parse: [] });
  });

  it("keeps pinging the assignee when retrying after a rate limit", async () => {
    const { notifier, fetch } = setup(json(429, { retry_after: 0 }), json(200));

    await notifier.notify(assigned(true));

    expect(sentBody(fetch, 1).allowed_mentions).toEqual({ users: [BOB_DISCORD] });
  });

  it("posts the formatted message to the channel with mentions disabled", async () => {
    const { notifier, fetch, log } = setup(json(200, { id: "1" }));

    await notifier.notify(event);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://discord.com/api/v10/channels/112233/messages");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bot ${TOKEN}`);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("user-agent")).toMatch(/^DiscordBot \(/);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({
      content:
        "🆕 🔥 **URGENT** `RF-1` \\@everyone \\*fix\\* prod · Urgent · by mona — <https://tasks.example.com/projects/shop/tasks/RF-1>",
      allowed_mentions: { parse: [] },
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("URL-encodes the channel id", async () => {
    const { notifier, fetch } = setup(json(200));
    await notifier.notify({ ...event, channelId: "../../guilds/1" });
    expect(fetch.mock.calls[0]![0]).toBe("https://discord.com/api/v10/channels/..%2F..%2Fguilds%2F1/messages");
  });

  it("retries once after a 429, waiting retry_after seconds", async () => {
    const { notifier, fetch, sleep, log } = setup(json(429, { retry_after: 1.5 }), json(200));

    await notifier.notify(event);

    expect(sleep).toHaveBeenCalledWith(1500);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(log).not.toHaveBeenCalled();
  });

  it("caps the 429 wait at 5 seconds and falls back to the Retry-After header", async () => {
    const capped = setup(json(429, { retry_after: 60 }), json(200));
    await capped.notifier.notify(event);
    expect(capped.sleep).toHaveBeenCalledWith(5000);

    const header = setup(new Response("rate limited", { status: 429, headers: { "retry-after": "2" } }), json(200));
    await header.notifier.notify(event);
    expect(header.sleep).toHaveBeenCalledWith(2000);
  });

  it("gives up after a second 429 and logs it", async () => {
    const { notifier, fetch, log } = setup(json(429, { retry_after: 0.1 }), json(429, { retry_after: 0.1 }));

    await expect(notifier.notify(event)).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(1);
    expect(loggedText(log)).toContain("429");
  });

  it("logs other error statuses without retrying or throwing", async () => {
    const { notifier, fetch, log } = setup(json(403, { message: "Missing Access" }));

    await expect(notifier.notify(event)).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(loggedText(log)).toContain("403");
    expect(loggedText(log)).toContain("112233");
    expect(loggedText(log)).not.toContain(TOKEN);
  });

  it("swallows network errors and timeouts, logging without the token", async () => {
    const { notifier, log } = setup(new DOMException("The operation timed out.", "TimeoutError"));

    await expect(notifier.notify(event)).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledTimes(1);
    expect(loggedText(log)).toContain("TimeoutError");
    expect(loggedText(log)).not.toContain(TOKEN);
  });
});
