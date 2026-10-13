import { describe, expect, it } from "vitest";
import type { NotificationEvent } from "../application/notifications.ts";
import { DISCORD_MESSAGE_LIMIT, escapeDiscordMarkdown, formatDiscordMessage } from "./discord-message.ts";

const BASE = "https://tasks.example.com";
const target = { channelId: "123", projectSlug: "shop" };
const task = { key: "RF-14", title: "Discord bot: post merged PRs" };
const TASK_LINK = "<https://tasks.example.com/projects/shop/tasks/RF-14>";
const MONA_DISCORD = "123456789012345678";
const unassigned = { assigneeLogin: null, assigneeDiscordUserId: null, ping: false } as const;

const pullRequest = (action: "opened" | "reopened" | "merged"): NotificationEvent => ({
  ...target,
  type: "pull_request",
  action,
  pullRequest: {
    number: 7,
    title: "Add checkout",
    branch: "feat/RF-1-checkout",
    url: "https://github.com/acme/shop/pull/7",
    authorLogin: "octocat",
  },
  taskKeys: ["RF-1", "RF-2"],
});

describe("escapeDiscordMarkdown", () => {
  it("backslash-escapes markdown, mention and link characters", () => {
    expect(escapeDiscordMarkdown("*bold* _it_ ~s~ `c` |sp| > # - [a](b) <@1> @everyone \\")).toBe(
      "\\*bold\\* \\_it\\_ \\~s\\~ \\`c\\` \\|sp\\| \\> \\# \\- \\[a\\]\\(b\\) \\<\\@1\\> \\@everyone \\\\",
    );
  });

  it("collapses line breaks so a message stays on one line", () => {
    expect(escapeDiscordMarkdown("a\r\nb\n\nc")).toBe("a b c");
  });
});

describe("formatDiscordMessage", () => {
  it("announces a created task with its priority, creator and link", () => {
    const message = formatDiscordMessage(
      { ...target, type: "task_created", task, priority: "high", actorLogin: "mona", ...unassigned },
      BASE,
    );
    expect(message).toBe(`🆕 \`RF-14\` Discord bot: post merged PRs · High · by mona — ${TASK_LINK}`);
  });

  it("emphasizes an urgent created task", () => {
    const message = formatDiscordMessage(
      { ...target, type: "task_created", task, priority: "urgent", actorLogin: "mona", ...unassigned },
      BASE,
    );
    expect(message).toBe(`🆕 🔥 **URGENT** \`RF-14\` Discord bot: post merged PRs · Urgent · by mona — ${TASK_LINK}`);
  });

  it("escapes the title and login of a created task", () => {
    const message = formatDiscordMessage(
      { ...target, type: "task_created", task: { key: "RF-1", title: "*fix* @everyone" }, priority: "low", actorLogin: "m_o", ...unassigned },
      BASE,
    );
    expect(message).toContain("\\*fix\\* \\@everyone · Low · by m\\_o — ");
  });

  it("announces imported tasks with the board link", () => {
    const message = formatDiscordMessage(
      { ...target, type: "tasks_imported", count: 57, explicitKeyCount: 43, doneCount: 0 },
      BASE,
    );
    expect(message).toBe(
      "📥 Imported 57 tasks into shop (43 with explicit keys). Board: <https://tasks.example.com/projects/shop>",
    );
  });

  it("mentions how many imported tasks were already done", () => {
    const message = formatDiscordMessage(
      { ...target, type: "tasks_imported", count: 16, explicitKeyCount: 16, doneCount: 11 },
      BASE,
    );
    expect(message).toBe(
      "📥 Imported 16 tasks into shop (16 with explicit keys, 11 already done). Board: <https://tasks.example.com/projects/shop>",
    );
  });

  it("uses the singular for one imported task", () => {
    const message = formatDiscordMessage(
      { ...target, type: "tasks_imported", count: 1, explicitKeyCount: 0, doneCount: 0 },
      BASE,
    );
    expect(message).toBe("📥 Imported 1 task into shop (0 with explicit keys). Board: <https://tasks.example.com/projects/shop>");
  });

  it("announces a task someone took", () => {
    const message = formatDiscordMessage(
      { ...target, type: "task_taken", task, assigneeLogin: "mona", assigneeDiscordUserId: null, ping: false, actorLogin: "mona" },
      BASE,
    );
    expect(message).toBe(`✋ mona took \`RF-14\` Discord bot: post merged PRs — ${TASK_LINK}`);
  });

  it("announces a task an admin assigned to someone else", () => {
    const message = formatDiscordMessage(
      { ...target, type: "task_taken", task, assigneeLogin: "mona", assigneeDiscordUserId: null, ping: false, actorLogin: "octocat" },
      BASE,
    );
    expect(message).toBe(`📌 mona was assigned \`RF-14\` Discord bot: post merged PRs by octocat — ${TASK_LINK}`);
  });

  it("mentions the linked Discord account of whoever took or was assigned a task", () => {
    const taken = (actorLogin: string, ping: boolean): NotificationEvent => ({
      ...target,
      type: "task_taken",
      task,
      assigneeLogin: "mona",
      assigneeDiscordUserId: MONA_DISCORD,
      ping,
      actorLogin,
    });
    expect(formatDiscordMessage(taken("mona", false), BASE)).toBe(
      `✋ <@${MONA_DISCORD}> took \`RF-14\` Discord bot: post merged PRs — ${TASK_LINK}`,
    );
    expect(formatDiscordMessage(taken("octocat", true), BASE)).toBe(
      `📌 <@${MONA_DISCORD}> was assigned \`RF-14\` Discord bot: post merged PRs by octocat — ${TASK_LINK}`,
    );
  });

  it("falls back to the escaped login when the Discord id is not a snowflake", () => {
    for (const assigneeDiscordUserId of ["everyone", "123", "1234567890123456789>", "<@&123456789012345678>", ""]) {
      const message = formatDiscordMessage(
        { ...target, type: "task_taken", task, assigneeLogin: "m_o", assigneeDiscordUserId, ping: true, actorLogin: "octocat" },
        BASE,
      );
      expect(message).toBe(`📌 m\\_o was assigned \`RF-14\` Discord bot: post merged PRs by octocat — ${TASK_LINK}`);
    }
  });

  it("keeps user text escaped next to a mention", () => {
    const message = formatDiscordMessage(
      {
        ...target,
        type: "task_taken",
        task: { key: "RF-1", title: "<@111111111111111111> @everyone" },
        assigneeLogin: "mona",
        assigneeDiscordUserId: MONA_DISCORD,
        ping: true,
        actorLogin: "<@222222222222222222>",
      },
      BASE,
    );
    expect(message).toContain(`<@${MONA_DISCORD}> was assigned`);
    expect(message).toContain("\\<\\@111111111111111111\\> \\@everyone by \\<\\@222222222222222222\\>");
    expect(message.match(/(?<!\\)<@/g)).toHaveLength(1);
  });

  it("names the assignee of a created task, as a mention when linked", () => {
    const created = (assigneeLogin: string | null, assigneeDiscordUserId: string | null): NotificationEvent => ({
      ...target,
      type: "task_created",
      task,
      priority: "high",
      actorLogin: "octocat",
      assigneeLogin,
      assigneeDiscordUserId,
      ping: assigneeDiscordUserId !== null,
    });
    expect(formatDiscordMessage(created("mona", MONA_DISCORD), BASE)).toBe(
      `🆕 \`RF-14\` Discord bot: post merged PRs · High · by octocat · assigned to <@${MONA_DISCORD}> — ${TASK_LINK}`,
    );
    expect(formatDiscordMessage(created("m_o", null), BASE)).toBe(
      `🆕 \`RF-14\` Discord bot: post merged PRs · High · by octocat · assigned to m\\_o — ${TASK_LINK}`,
    );
    expect(formatDiscordMessage(created("m_o", "not-a-snowflake"), BASE)).toContain("· assigned to m\\_o — ");
    expect(formatDiscordMessage(created(null, null), BASE)).toBe(
      `🆕 \`RF-14\` Discord bot: post merged PRs · High · by octocat — ${TASK_LINK}`,
    );
  });

  it("announces opened, reopened and merged pull requests with their tasks", () => {
    expect(formatDiscordMessage(pullRequest("opened"), BASE)).toBe(
      "🔀 octocat opened PR #7 Add checkout (feat/RF\\-1\\-checkout) for RF-1, RF-2 — <https://github.com/acme/shop/pull/7>",
    );
    expect(formatDiscordMessage(pullRequest("reopened"), BASE)).toContain("🔀 octocat reopened PR #7");
    expect(formatDiscordMessage(pullRequest("merged"), BASE)).toBe(
      "✅ PR #7 Add checkout by octocat was merged for RF-1, RF-2 — <https://github.com/acme/shop/pull/7>",
    );
  });

  it("announces an unblocked task, mentioning its assignee when it has one", () => {
    expect(formatDiscordMessage({ ...target, type: "task_unblocked", task, assigneeLogin: null }, BASE)).toBe(
      `🔓 RF-14 Discord bot: post merged PRs is now available to take. — ${TASK_LINK}`,
    );
    expect(formatDiscordMessage({ ...target, type: "task_unblocked", task, assigneeLogin: "bob" }, BASE)).toBe(
      `🔓 RF-14 Discord bot: post merged PRs is unblocked (assigned to bob). — ${TASK_LINK}`,
    );
  });

  it("escapes user text and URL-encodes the task link", () => {
    const message = formatDiscordMessage(
      {
        channelId: "1",
        projectSlug: "my shop",
        type: "task_unblocked",
        task: { key: "RF-1", title: "@everyone **now** [x](https://evil.example)" },
        assigneeLogin: null,
      },
      BASE,
    );
    expect(message).toContain("\\@everyone \\*\\*now\\*\\* \\[x\\]\\(https://evil.example\\)");
    expect(message).toContain("<https://tasks.example.com/projects/my%20shop/tasks/RF-1>");
  });

  it("shortens long titles and long task lists", () => {
    const longTitle = "x".repeat(500);
    const keys = Array.from({ length: 40 }, (_, i) => `RF-${i + 1}`);
    const message = formatDiscordMessage(
      {
        ...target,
        type: "pull_request",
        action: "opened",
        pullRequest: { number: 7, title: longTitle, branch: "b", url: "https://github.com/acme/shop/pull/7", authorLogin: "octocat" },
        taskKeys: keys,
      },
      BASE,
    );
    expect(message).toContain(`${"x".repeat(199)}…`);
    expect(message).not.toContain("x".repeat(201));
    expect(message).toContain("RF-20 and 20 more");
    expect(message.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
  });

  it("never exceeds Discord's message limit", () => {
    const message = formatDiscordMessage(
      {
        ...target,
        type: "task_created",
        task: { key: "RF-1", title: "*".repeat(5000) },
        priority: "urgent",
        actorLogin: "-".repeat(3000),
        ...unassigned,
      },
      BASE,
    );
    expect(message.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
  });
});
