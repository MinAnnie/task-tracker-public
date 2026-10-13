import { beforeEach, describe, expect, it } from "vitest";
import { RecordingNotifications } from "../../test/fakes/recording-notifications.ts";
import type { TaskStatus } from "../domain/index.ts";
import {
  handlePullRequestEvent,
  type PullRequestEventInput,
  type PullRequestState,
  type PullRequestUpsert,
  type PullRequestWebhookStore,
  type RepositoryRecord,
  type TaskRecord,
} from "./handle-pull-request-event.ts";

/** In-memory implementation of the port, mirroring the database constraints. */
class InMemoryStore implements PullRequestWebhookStore {
  repositories: RepositoryRecord[] = [];
  tasks: (TaskRecord & { projectId: number; title?: string; hasPendingDependencies?: boolean })[] = [];
  dependencies: { taskId: number; dependsOnTaskId: number }[] = [];
  pullRequests: (PullRequestUpsert & { id: number })[] = [];
  links: { taskId: number; pullRequestId: number }[] = [];
  transactions = 0;

  async transaction<T>(work: (store: PullRequestWebhookStore) => Promise<T>): Promise<T> {
    this.transactions += 1;
    return work(this);
  }

  async findRepositoryByFullName(fullName: string) {
    return this.repositories.find((r) => r.githubFullName === fullName);
  }

  async setRepositoryInstallationId(repositoryId: number, installationId: number) {
    const repository = this.repositories.find((r) => r.id === repositoryId);
    if (repository) repository.githubInstallationId = installationId;
  }

  async upsertPullRequest(data: PullRequestUpsert) {
    const existing = this.pullRequests.find(
      (pr) => pr.repositoryId === data.repositoryId && pr.number === data.number,
    );
    if (existing) {
      Object.assign(existing, data);
      return { id: existing.id };
    }
    const id = this.pullRequests.length + 1;
    this.pullRequests.push({ ...data, id });
    return { id };
  }

  async listProjectTasks(projectId: number) {
    return this.tasks
      .filter((t) => t.projectId === projectId)
      .map(({ id, key, status }) => ({ id, key, status }));
  }

  async linkTasks(pullRequestId: number, taskIds: readonly number[]) {
    for (const taskId of taskIds) {
      const exists = this.links.some(
        (l) => l.taskId === taskId && l.pullRequestId === pullRequestId,
      );
      if (!exists) this.links.push({ taskId, pullRequestId });
    }
  }

  async listLinkedTasks(pullRequestId: number) {
    const ids = new Set(
      this.links.filter((l) => l.pullRequestId === pullRequestId).map((l) => l.taskId),
    );
    return this.tasks
      .filter((t) => ids.has(t.id))
      .map(({ id, key, title, status, hasPendingDependencies = false }) => ({
        id,
        key,
        title: title ?? `Task ${key}`,
        status,
        hasPendingDependencies,
      }));
  }

  async findPullRequestState(repositoryId: number, number: number): Promise<PullRequestState | undefined> {
    return this.pullRequests.find((pr) => pr.repositoryId === repositoryId && pr.number === number)?.state;
  }

  async findUnblockedDependents(taskIds: readonly number[]) {
    const statusOf = (id: number) => this.tasks.find((t) => t.id === id)?.status;
    return this.tasks
      .filter((t) => this.dependencies.some((d) => d.taskId === t.id && taskIds.includes(d.dependsOnTaskId)))
      .filter((t) => t.status !== "done")
      .filter((t) => !this.dependencies.some((d) => d.taskId === t.id && statusOf(d.dependsOnTaskId) !== "done"))
      .map(({ key, title }) => ({ key, title: title ?? `Task ${key}`, assigneeLogin: null }));
  }

  async updateTaskStatus(taskId: number, status: TaskStatus) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (task) task.status = status;
  }

  statusOf(key: string): TaskStatus | undefined {
    return this.tasks.find((t) => t.key === key)?.status;
  }

  linkedKeys(): string[] {
    return this.links.map((l) => this.tasks.find((t) => t.id === l.taskId)?.key ?? "?");
  }
}

const event = (overrides: Partial<PullRequestEventInput> = {}): PullRequestEventInput => ({
  action: "opened",
  repositoryFullName: "acme/shop",
  installationId: 99,
  pullRequest: {
    number: 7,
    title: "Add checkout",
    branch: "feat/RF-04-wompi",
    url: "https://github.com/acme/shop/pull/7",
    authorLogin: "octocat",
    state: "open",
    merged: false,
    createdAt: new Date("2026-01-01T10:00:00Z"),
    mergedAt: null,
    closedAt: null,
  },
  ...overrides,
});

const withPr = (
  pr: Partial<PullRequestEventInput["pullRequest"]>,
  action: PullRequestEventInput["action"] = "opened",
): PullRequestEventInput => {
  const base = event();
  return { ...base, action, pullRequest: { ...base.pullRequest, ...pr } };
};

const merged = (): PullRequestEventInput =>
  withPr(
    {
      state: "closed",
      merged: true,
      mergedAt: new Date("2026-01-02T10:00:00Z"),
      closedAt: new Date("2026-01-02T10:00:00Z"),
    },
    "closed",
  );

const closedUnmerged = (): PullRequestEventInput =>
  withPr({ state: "closed", merged: false, closedAt: new Date("2026-01-02T10:00:00Z") }, "closed");

describe("handlePullRequestEvent", () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
    store.repositories = [
      {
        id: 1,
        projectId: 10,
        projectSlug: "shop",
        discordChannelId: "998877",
        githubFullName: "acme/shop",
        githubInstallationId: null,
      },
    ];
    store.tasks = [
      { id: 100, projectId: 10, key: "RF-04", status: "todo" },
      { id: 101, projectId: 10, key: "RF-05", status: "in_progress" },
      { id: 102, projectId: 10, key: "AB-1", status: "done" },
      { id: 200, projectId: 20, key: "RF-06", status: "todo" },
    ];
  });

  describe("tasks with pending dependencies", () => {
    beforeEach(() => {
      store.tasks[0]!.hasPendingDependencies = true;
    });

    it.each([
      ["opened", () => event()],
      ["merged", merged],
    ])("links the pull request on %s but keeps the task status", async (_, input) => {
      const result = await handlePullRequestEvent(store, input());

      expect(result).toMatchObject({ status: "processed", linkedTaskKeys: ["RF-04"], statusChanges: [] });
      expect(store.linkedKeys()).toEqual(["RF-04"]);
      expect(store.statusOf("RF-04")).toBe("todo");
    });

    it("still moves the other linked tasks", async () => {
      const result = await handlePullRequestEvent(store, withPr({ title: "RF-04 and RF-05" }));

      expect(result).toMatchObject({
        statusChanges: [{ taskKey: "RF-05", from: "in_progress", to: "in_review" }],
      });
      expect(store.statusOf("RF-04")).toBe("todo");
    });
  });

  it("ignores events from unregistered repositories", async () => {
    const result = await handlePullRequestEvent(store, event({ repositoryFullName: "other/repo" }));
    expect(result).toEqual({ status: "ignored", reason: "unknown_repository" });
    expect(store.pullRequests).toEqual([]);
  });

  it("finds the repository regardless of the casing GitHub reports", async () => {
    const result = await handlePullRequestEvent(store, event({ repositoryFullName: "Acme/Shop" }));
    expect(result).toMatchObject({ status: "processed" });
  });

  it("ignores unsupported actions without touching the store", async () => {
    const result = await handlePullRequestEvent(store, event({ action: "labeled" }));
    expect(result).toEqual({ status: "ignored", reason: "unsupported_action" });
    expect(store.pullRequests).toEqual([]);
    expect(store.transactions).toBe(0);
  });

  it("records the installation id when the repository has none", async () => {
    await handlePullRequestEvent(store, event());
    expect(store.repositories[0]?.githubInstallationId).toBe(99);
  });

  it("does not overwrite an existing installation id", async () => {
    store.repositories[0]!.githubInstallationId = 5;
    await handlePullRequestEvent(store, event());
    expect(store.repositories[0]?.githubInstallationId).toBe(5);
  });

  it("upserts the pull request with its metadata", async () => {
    await handlePullRequestEvent(store, event());
    expect(store.pullRequests).toEqual([
      {
        id: 1,
        repositoryId: 1,
        number: 7,
        title: "Add checkout",
        branch: "feat/RF-04-wompi",
        url: "https://github.com/acme/shop/pull/7",
        authorGithubLogin: "octocat",
        state: "open",
        openedAt: new Date("2026-01-01T10:00:00Z"),
        mergedAt: null,
        closedAt: null,
      },
    ]);
  });

  it("links a task found in the branch name and moves it to in_review", async () => {
    const result = await handlePullRequestEvent(store, event());
    expect(store.linkedKeys()).toEqual(["RF-04"]);
    expect(store.statusOf("RF-04")).toBe("in_review");
    expect(result).toEqual({
      status: "processed",
      pullRequestId: 1,
      linkedTaskKeys: ["RF-04"],
      statusChanges: [{ taskKey: "RF-04", from: "todo", to: "in_review" }],
    });
  });

  it("links a task found in the title", async () => {
    await handlePullRequestEvent(store, withPr({ title: "[RF-05] Add refunds", branch: "main" }));
    expect(store.linkedKeys()).toEqual(["RF-05"]);
    expect(store.statusOf("RF-05")).toBe("in_review");
  });

  it("only links keys of the repository's own project", async () => {
    await handlePullRequestEvent(store, withPr({ title: "RF-06", branch: "x" }));
    expect(store.links).toEqual([]);
  });

  it("moves linked tasks to done when the pull request is merged", async () => {
    await handlePullRequestEvent(store, event());
    const result = await handlePullRequestEvent(store, merged());
    expect(store.statusOf("RF-04")).toBe("done");
    expect(store.pullRequests[0]).toMatchObject({ state: "merged" });
    expect(result).toMatchObject({
      statusChanges: [{ taskKey: "RF-04", from: "in_review", to: "done" }],
    });
  });

  it("moves in_review tasks back to in_progress when closed without merging", async () => {
    await handlePullRequestEvent(store, event());
    await handlePullRequestEvent(store, closedUnmerged());
    expect(store.statusOf("RF-04")).toBe("in_progress");
    expect(store.pullRequests[0]).toMatchObject({ state: "closed" });
  });

  it("never moves a done task out of done", async () => {
    const title = "AB-1 follow-up";
    await handlePullRequestEvent(store, withPr({ title }));
    const closed = closedUnmerged();
    await handlePullRequestEvent(store, { ...closed, pullRequest: { ...closed.pullRequest, title } });
    expect(store.statusOf("AB-1")).toBe("done");
  });

  it("links new keys on synchronize without changing any status", async () => {
    await handlePullRequestEvent(store, event());
    const result = await handlePullRequestEvent(
      store,
      withPr({ title: "Add checkout and RF-05" }, "synchronize"),
    );
    expect(store.linkedKeys()).toEqual(["RF-04", "RF-05"]);
    expect(store.statusOf("RF-04")).toBe("in_review");
    expect(store.statusOf("RF-05")).toBe("in_progress");
    expect(result).toMatchObject({ linkedTaskKeys: ["RF-04", "RF-05"], statusChanges: [] });
  });

  it("keeps existing links when an edit removes the key from the title and branch", async () => {
    await handlePullRequestEvent(store, event());
    await handlePullRequestEvent(store, withPr({ branch: "renamed" }, "edited"));
    expect(store.linkedKeys()).toEqual(["RF-04"]);
  });

  it("applies status transitions to every linked task, including earlier links", async () => {
    await handlePullRequestEvent(store, event());
    const mergedFromMain = merged();
    mergedFromMain.pullRequest.branch = "main";
    await handlePullRequestEvent(store, mergedFromMain);
    expect(store.statusOf("RF-04")).toBe("done");
  });

  it("is idempotent when the same delivery is received twice", async () => {
    await handlePullRequestEvent(store, event());
    const second = await handlePullRequestEvent(store, event());
    expect(store.pullRequests).toHaveLength(1);
    expect(store.links).toHaveLength(1);
    expect(store.statusOf("RF-04")).toBe("in_review");
    expect(second).toMatchObject({ statusChanges: [] });
  });

  it("runs the write side inside a transaction", async () => {
    await handlePullRequestEvent(store, event());
    expect(store.transactions).toBe(1);
  });
});

describe("handlePullRequestEvent notifications", () => {
  let store: InMemoryStore;
  let notifications: RecordingNotifications;
  const target = { channelId: "998877", projectSlug: "shop" };
  const prEvent = (action: "opened" | "reopened" | "merged", taskKeys: string[]) => ({
    ...target,
    type: "pull_request",
    action,
    pullRequest: {
      number: 7,
      title: "Add checkout",
      branch: "feat/RF-04-wompi",
      url: "https://github.com/acme/shop/pull/7",
      authorLogin: "octocat",
    },
    taskKeys,
  });
  const unblocked = (key: string) => ({
    ...target,
    type: "task_unblocked",
    task: { key, title: `Task ${key}` },
    assigneeLogin: null,
  });

  beforeEach(() => {
    store = new InMemoryStore();
    store.repositories = [
      {
        id: 1,
        projectId: 10,
        projectSlug: "shop",
        discordChannelId: "998877",
        githubFullName: "acme/shop",
        githubInstallationId: null,
      },
    ];
    store.tasks = [
      { id: 100, projectId: 10, key: "RF-04", status: "in_review" },
      { id: 101, projectId: 10, key: "RF-05", status: "todo" },
      { id: 102, projectId: 10, key: "RF-10", status: "todo" },
      { id: 103, projectId: 10, key: "RF-11", status: "todo" },
      { id: 104, projectId: 10, key: "RF-12", status: "todo" },
    ];
    notifications = new RecordingNotifications();
  });

  /** Fails the test if anything is published while the transaction is still open. */
  const assertPublishedAfterCommit = () => {
    const transaction = store.transaction.bind(store);
    store.transaction = async <T>(work: (tx: PullRequestWebhookStore) => Promise<T>) => {
      const before = notifications.events.length;
      const result = await transaction(work);
      expect(notifications.events).toHaveLength(before);
      return result;
    };
  };

  it("announces an opened pull request once, with every linked task", async () => {
    assertPublishedAfterCommit();
    await handlePullRequestEvent(store, withPr({ title: "RF-05 checkout" }), notifications);
    // A redelivery, or an edit that changes nothing, stays silent.
    await handlePullRequestEvent(store, withPr({ title: "RF-05 checkout" }), notifications);
    await handlePullRequestEvent(store, withPr({ title: "RF-05 checkout" }, "edited"), notifications);

    const opened = prEvent("opened", ["RF-04", "RF-05"]);
    expect(notifications.events).toEqual([{ ...opened, pullRequest: { ...opened.pullRequest, title: "RF-05 checkout" } }]);
  });

  it("announces reopened and merged pull requests, but not closed unmerged ones", async () => {
    await handlePullRequestEvent(store, event(), notifications);
    await handlePullRequestEvent(store, closedUnmerged(), notifications);
    await handlePullRequestEvent(store, withPr({}, "reopened"), notifications);
    await handlePullRequestEvent(store, merged(), notifications);
    await handlePullRequestEvent(store, merged(), notifications);

    expect(notifications.events.map((e) => e.type === "pull_request" && e.action)).toEqual([
      "opened",
      "reopened",
      "merged",
    ]);
  });

  it("stays silent for pull requests without linked tasks or projects without a channel", async () => {
    await handlePullRequestEvent(store, withPr({ title: "Chore", branch: "chore/deps" }), notifications);
    store.repositories[0]!.discordChannelId = null;
    await handlePullRequestEvent(store, merged(), notifications);

    expect(notifications.events).toEqual([]);
  });

  it("announces the dependents a merge unblocked, after the merge itself", async () => {
    store.dependencies.push(
      { taskId: 102, dependsOnTaskId: 100 },
      { taskId: 103, dependsOnTaskId: 100 },
      { taskId: 103, dependsOnTaskId: 104 },
    );
    assertPublishedAfterCommit();

    await handlePullRequestEvent(store, merged(), notifications);

    expect(store.statusOf("RF-04")).toBe("done");
    expect(notifications.events).toEqual([prEvent("merged", ["RF-04"]), unblocked("RF-10")]);
  });

  it("ignores unknown repositories and unsupported actions", async () => {
    await handlePullRequestEvent(store, event({ repositoryFullName: "other/repo" }), notifications);
    await handlePullRequestEvent(store, withPr({}, "labeled"), notifications);
    expect(notifications.events).toEqual([]);
  });
});
