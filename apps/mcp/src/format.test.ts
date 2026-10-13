import { describe, expect, it } from "vitest";
import {
  branchSlug,
  formatNextTasks,
  formatProjects,
  formatTaskList,
  formatTaskPrompt,
  suggestedBranch,
} from "./format.ts";
import { listItem, taskDetail } from "./test-fixtures.ts";

const project = { slug: "rf", name: "Rental Fleet" };

describe("branchSlug / suggestedBranch", () => {
  it("lowercases, drops accents and joins words with -", () => {
    expect(branchSlug("  Añadir Login: GitHub OAuth! ")).toBe("anadir-login-github-oauth");
  });

  it("cuts at a word boundary within 50 characters", () => {
    const slug = branchSlug("word ".repeat(20));
    expect(slug.length).toBeLessThanOrEqual(50);
    expect(slug.endsWith("-")).toBe(false);
    expect(branchSlug("a".repeat(60))).toBe("a".repeat(50));
  });

  it("builds feat/<KEY>-<slug>, or feat/<KEY> when the title has no usable characters", () => {
    expect(suggestedBranch("RF-14", "Add login")).toBe("feat/RF-14-add-login");
    expect(suggestedBranch("RF-14", "¿¿??")).toBe("feat/RF-14");
  });
});

describe("formatTaskPrompt", () => {
  it("renders the AI-ready markdown brief", () => {
    const task = taskDetail({
      stage: "Etapa 1",
      status: "in_progress",
      assignee: { login: "alice", name: "Alice", avatarUrl: null },
      dependsOn: [
        { key: "RF-10", title: "B", status: "todo" },
        { key: "RF-2", title: "A", status: "done" },
      ],
      blocks: [
        { key: "RF-20", title: "C", status: "todo" },
        { key: "RF-15", title: "D", status: "blocked" },
      ],
      pullRequests: [
        { number: 7, title: "Login", branch: "feat/RF-14-login", url: "https://gh/7", state: "open", author: "alice" },
        { number: 9, title: "Fix", branch: "feat/RF-14-fix", url: "https://gh/9", state: "merged", author: "bob" },
      ],
    });
    expect(formatTaskPrompt(task, project, "https://tracker.test")).toBe(
      [
        "# RF-14 — Add login with GitHub",
        "",
        "- Project: Rental Fleet",
        "- Status: In progress · Priority: High · Stage: Etapa 1",
        "- Assignee: @alice",
        "- Depends on: RF-2 (Done), RF-10 (To do)",
        "- Blocks: RF-15, RF-20",
        "- Linked pull requests: #7 Login (open), #9 Fix (merged)",
        "- Branch: feat/RF-14-add-login-with-github",
        "- Link: https://tracker.test/projects/rf/tasks/RF-14",
        "",
        "## Description",
        "",
        "Use the OAuth app.\n\n- keep it simple",
      ].join("\n"),
    );
  });

  it("uses fallbacks for empty fields", () => {
    const text = formatTaskPrompt(taskDetail({ description: null }), project, "https://tracker.test");
    expect(text).toContain("- Status: To do · Priority: High\n");
    expect(text).toContain("- Assignee: Unassigned");
    expect(text).toContain("- Depends on: None");
    expect(text).toContain("- Blocks: Nothing");
    expect(text).not.toContain("Linked pull requests");
    expect(text.endsWith("## Description\n\nNo description.")).toBe(true);
  });
});

describe("formatTaskList", () => {
  it("lists one line per task with counts and waiting-on notes", () => {
    const tasks = [
      listItem({
        key: "RF-1",
        title: "Board",
        priority: "urgent",
        stage: "Etapa 1",
        status: "in_progress",
        assignee: { login: "alice", name: null, avatarUrl: null },
      }),
      listItem({ key: "RF-3", title: "Search", pendingDependencies: ["RF-1", "RF-2"] }),
    ];
    expect(formatTaskList({ project, shown: tasks, matched: 5, total: 12 })).toBe(
      [
        "Rental Fleet (rf): 5 of 12 tasks match; showing 2.",
        "",
        "KEY · status · priority · stage · assignee · title",
        "RF-1 · in_progress · urgent · Etapa 1 · @alice · Board",
        "RF-3 · todo · medium · — · unassigned · Search — waiting on RF-1, RF-2",
      ].join("\n"),
    );
  });

  it("says so when nothing matches", () => {
    expect(formatTaskList({ project, shown: [], matched: 0, total: 3 })).toBe(
      "Rental Fleet (rf): 0 of 3 tasks match the filters.",
    );
  });
});

describe("formatNextTasks", () => {
  it("explains why each task is ready and what it unblocks", () => {
    const text = formatNextTasks({
      project,
      entries: [
        {
          task: listItem({ key: "RF-4", title: "Export", priority: "high", dependsOn: ["RF-1"] }),
          unblocks: ["RF-5", "RF-6"],
        },
        { task: listItem({ key: "RF-7", title: "Docs", stage: "Etapa 2", status: "blocked" }), unblocks: [] },
      ],
      readyCount: 3,
    });
    expect(text).toBe(
      [
        "Rental Fleet (rf): 3 ready tasks; showing the top 2 by priority.",
        "",
        "1. RF-4 · high · — · Export",
        "   Ready: unassigned, status todo, its 1 dependency is done. Unblocks: RF-5, RF-6.",
        "2. RF-7 · medium · Etapa 2 · Docs",
        "   Ready: unassigned, status blocked, no dependencies. Unblocks nothing.",
        "",
        "Use get_task with a key for the full brief.",
      ].join("\n"),
    );
  });

  it("pluralizes dependencies", () => {
    const text = formatNextTasks({
      project,
      entries: [{ task: listItem({ key: "RF-4", dependsOn: ["RF-1", "RF-2"] }), unblocks: ["RF-9"] }],
      readyCount: 1,
    });
    expect(text).toContain("Rental Fleet (rf): 1 ready task; showing the top 1 by priority.");
    expect(text).toContain("its 2 dependencies are done. Unblocks: RF-9.");
  });

  it("says so when nothing is ready", () => {
    expect(formatNextTasks({ project, entries: [], readyCount: 0 })).toBe(
      "Rental Fleet (rf): no task is ready (every open task is assigned or waiting on dependencies).",
    );
  });
});

describe("formatProjects", () => {
  it("lists slug, name and key prefix", () => {
    expect(formatProjects([{ id: 1, slug: "rf", name: "Rental Fleet", taskKeyPrefix: "RF" }])).toBe(
      "1 project visible to this token:\n- rf · Rental Fleet · keys RF-<n>",
    );
    expect(formatProjects([])).toBe("No project is visible to this token.");
  });
});
