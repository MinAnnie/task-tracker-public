import { describe, expect, it } from "vitest";
import { taskDetail } from "../../test/fixtures.ts";
import { branchSlug, buildTaskPrompt, suggestedBranch } from "./task-prompt.ts";

const project = { slug: "acme", name: "Acme" };
const origin = "https://tracker.example.com";

/**
 * Mirrors the server's `extractTaskKeys` rule (apps/server/src/domain/extract-task-keys.ts):
 * a key matches case-insensitively when not glued to other letters or digits.
 */
const serverFindsKey = (text: string, key: string) =>
  new RegExp(`(?<![a-z0-9])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "i").test(text);

describe("branchSlug", () => {
  it.each([
    ["App wallet: ledger y holds", "app-wallet-ledger-y-holds"],
    ["Análisis de Señales & Diseño", "analisis-de-senales-diseno"],
    ["  --Hello,   World!!--  ", "hello-world"],
    ["Ünïcödé çàfé", "unicode-cafe"],
    ["¿¡!?", ""],
  ])("turns %j into %j", (title, slug) => {
    expect(branchSlug(title)).toBe(slug);
  });

  it("cuts long titles at a word boundary, at most 50 characters", () => {
    const slug = branchSlug("Integrate the payment gateway with recurring subscriptions and refunds");
    expect(slug).toBe("integrate-the-payment-gateway-with-recurring");
    expect(slug.length).toBeLessThanOrEqual(50);
  });

  it("hard-cuts a single word longer than the limit", () => {
    expect(branchSlug("a".repeat(70))).toBe("a".repeat(50));
  });
});

describe("suggestedBranch", () => {
  it("keeps the key's case and appends the slug", () => {
    expect(suggestedBranch("AUTH-08B", "Login con Google")).toBe("feat/AUTH-08B-login-con-google");
  });

  it("is just the key when the title has no usable characters", () => {
    expect(suggestedBranch("RF-1", "!!!")).toBe("feat/RF-1");
  });

  it.each([
    ["DOM-02", "App wallet: ledger y holds"],
    ["AUTH-08B", "8 bits"],
    ["RF-4", "042 numbers first"],
  ])("lets the server find %s in the branch", (key, title) => {
    expect(serverFindsKey(suggestedBranch(key, title), key)).toBe(true);
  });
});

describe("buildTaskPrompt", () => {
  it("describes every field of the task", () => {
    const task = taskDetail({
      key: "DOM-02",
      title: "App wallet: ledger y holds",
      description: "## Goal\n\n- Keep a **ledger**\n- `holds` table\n",
      status: "todo",
      priority: "high",
      stage: "Etapa 0 — Análisis y diseño",
      assignee: { login: "annamiller", name: "Anna", avatarUrl: null },
      dependsOn: [
        { key: "DOM-10", title: "Ten", status: "done" },
        { key: "DOM-01", title: "One", status: "todo" },
      ],
      blocks: [
        { key: "RF-33", title: "x", status: "todo" },
        { key: "RF-12", title: "y", status: "in_progress" },
      ],
      pullRequests: [
        { number: 27, title: "feat: wallet", branch: "b", url: "u", state: "open", author: "a" },
        { number: 30, title: "fix: holds", branch: "c", url: "v", state: "merged", author: "a" },
      ],
    });

    expect(buildTaskPrompt(task, project, origin)).toBe(
      [
        "# DOM-02 — App wallet: ledger y holds",
        "",
        "- Project: Acme",
        "- Status: To do · Priority: High · Stage: Etapa 0 — Análisis y diseño",
        "- Assignee: @annamiller",
        "- Depends on: DOM-01 (To do), DOM-10 (Done)",
        "- Blocks: RF-12, RF-33",
        "- Linked pull requests: #27 feat: wallet (open), #30 fix: holds (merged)",
        "- Branch: feat/DOM-02-app-wallet-ledger-y-holds",
        "- Link: https://tracker.example.com/projects/acme/tasks/DOM-02",
        "",
        "## Description",
        "",
        "## Goal\n\n- Keep a **ledger**\n- `holds` table\n",
      ].join("\n"),
    );
  });

  it("spells out the empty cases and omits the pull request line", () => {
    const task = taskDetail({
      key: "RF-14",
      title: "Bot",
      description: null,
      status: "in_review",
      priority: "low",
      stage: null,
      assignee: null,
    });

    expect(buildTaskPrompt(task, project, origin)).toBe(
      [
        "# RF-14 — Bot",
        "",
        "- Project: Acme",
        "- Status: In review · Priority: Low",
        "- Assignee: Unassigned",
        "- Depends on: None",
        "- Blocks: Nothing",
        "- Branch: feat/RF-14-bot",
        "- Link: https://tracker.example.com/projects/acme/tasks/RF-14",
        "",
        "## Description",
        "",
        "No description.",
      ].join("\n"),
    );
  });

  it("treats an empty description as missing", () => {
    expect(buildTaskPrompt(taskDetail({ description: "" }), project, origin)).toMatch(/\n\nNo description\.$/);
  });

  it("encodes the link like the app's routes", () => {
    const prompt = buildTaskPrompt(taskDetail({ key: "AUTH-08B" }), { slug: "my app", name: "My" }, origin);
    expect(prompt).toContain("- Link: https://tracker.example.com/projects/my%20app/tasks/AUTH-08B");
  });
});
