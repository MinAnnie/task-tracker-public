import { eq, sql as rawSql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RecordingNotifications } from "../../test/fakes/recording-notifications.ts";
import { testDatabaseUrl } from "../../test/integration/database-url.ts";
import {
  handlePullRequestEvent,
  type PullRequestEventInput,
} from "../application/handle-pull-request-event.ts";
import { createDb } from "../db/client.ts";
import {
  projects,
  pullRequests,
  repositories,
  taskDependencies,
  taskPullRequests,
  tasks,
} from "../db/schema.ts";
import { createDrizzlePullRequestWebhookStore } from "./drizzle-pull-request-webhook-store.ts";

const { sql, db } = createDb(testDatabaseUrl);
const store = createDrizzlePullRequestWebhookStore(db);

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

const openedEvent = (): PullRequestEventInput => ({
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
});

const mergedEvent = (): PullRequestEventInput => {
  const event = openedEvent();
  return {
    ...event,
    action: "closed",
    pullRequest: {
      ...event.pullRequest,
      state: "closed",
      merged: true,
      mergedAt: new Date("2026-01-02T10:00:00Z"),
      closedAt: new Date("2026-01-02T10:00:00Z"),
    },
  };
};

const taskStatus = async (key: string) => {
  const [row] = await db
    .select({ status: tasks.status })
    .from(tasks)
    .where(eq(tasks.key, key));
  return row?.status;
};

const linkedKeys = async () => {
  const rows = await db
    .select({ key: tasks.key })
    .from(taskPullRequests)
    .innerJoin(tasks, eq(tasks.id, taskPullRequests.taskId))
    .orderBy(tasks.key);
  return rows.map((r) => r.key);
};

const installationId = async () => {
  const [row] = await db.select({ id: repositories.githubInstallationId }).from(repositories);
  return row?.id;
};

describe("createDrizzlePullRequestWebhookStore (Postgres)", () => {
  beforeEach(async () => {
    await db.execute(
      rawSql`truncate table task_pull_requests, pull_requests, tasks, repositories, users, projects restart identity cascade`,
    );
    const [project] = await db
      .insert(projects)
      .values({ slug: "shop", name: "Shop", taskKeyPrefix: "RF" })
      .returning({ id: projects.id });
    const [other] = await db
      .insert(projects)
      .values({ slug: "other", name: "Other", taskKeyPrefix: "OT" })
      .returning({ id: projects.id });
    await db
      .insert(repositories)
      .values({ projectId: project!.id, githubFullName: "acme/shop" });
    await db.insert(tasks).values([
      { projectId: project!.id, key: "RF-04", title: "Payments" },
      { projectId: project!.id, key: "RF-05", title: "Refunds", status: "in_progress" },
      { projectId: other!.id, key: "RF-06", title: "Elsewhere" },
    ]);
  });

  it("links a task with pending dependencies without moving it until they are done", async () => {
    const taskId = async (key: string) =>
      (await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.key, key)))[0]!.id;
    await db
      .insert(taskDependencies)
      .values({ taskId: await taskId("RF-04"), dependsOnTaskId: await taskId("RF-05") });

    const opened = await handlePullRequestEvent(store, openedEvent());

    expect(opened).toMatchObject({ linkedTaskKeys: ["RF-04"], statusChanges: [] });
    expect(await linkedKeys()).toEqual(["RF-04"]);
    expect(await taskStatus("RF-04")).toBe("todo");

    await db.update(tasks).set({ status: "done" }).where(eq(tasks.key, "RF-05"));
    const result = await handlePullRequestEvent(store, mergedEvent());

    expect(result).toMatchObject({ statusChanges: [{ taskKey: "RF-04", from: "todo", to: "done" }] });
  });

  it("ignores events from unknown repositories without writing", async () => {
    const result = await handlePullRequestEvent(store, {
      ...openedEvent(),
      repositoryFullName: "acme/unknown",
    });
    expect(result).toEqual({ status: "ignored", reason: "unknown_repository" });
    expect(await db.select().from(pullRequests)).toEqual([]);
  });

  it("creates the pull request, links the task and moves it to in_review", async () => {
    const result = await handlePullRequestEvent(store, openedEvent());

    expect(result).toEqual({
      status: "processed",
      pullRequestId: 1,
      linkedTaskKeys: ["RF-04"],
      statusChanges: [{ taskKey: "RF-04", from: "todo", to: "in_review" }],
    });
    expect(await db.select().from(pullRequests)).toEqual([
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
    expect(await linkedKeys()).toEqual(["RF-04"]);
    expect(await taskStatus("RF-04")).toBe("in_review");
  });

  it("is idempotent when the same delivery is received twice", async () => {
    await handlePullRequestEvent(store, openedEvent());
    const second = await handlePullRequestEvent(store, openedEvent());

    expect(second).toMatchObject({ pullRequestId: 1, statusChanges: [] });
    expect(await db.select().from(pullRequests)).toHaveLength(1);
    expect(await db.select().from(taskPullRequests)).toHaveLength(1);
    expect(await taskStatus("RF-04")).toBe("in_review");
  });

  it("marks the pull request merged and the linked task done", async () => {
    await handlePullRequestEvent(store, openedEvent());
    await handlePullRequestEvent(store, mergedEvent());

    const [pr] = await db.select().from(pullRequests);
    expect(pr).toMatchObject({
      state: "merged",
      mergedAt: new Date("2026-01-02T10:00:00Z"),
      closedAt: new Date("2026-01-02T10:00:00Z"),
    });
    expect(await taskStatus("RF-04")).toBe("done");
  });

  it("sets the installation id only when it is null", async () => {
    await handlePullRequestEvent(store, openedEvent());
    expect(await installationId()).toBe(99);

    await handlePullRequestEvent(store, { ...openedEvent(), installationId: 123 });
    expect(await installationId()).toBe(99);
  });

  it("adds a link on synchronize with a new branch key and keeps the old one", async () => {
    await handlePullRequestEvent(store, openedEvent());
    const event = openedEvent();
    const result = await handlePullRequestEvent(store, {
      ...event,
      action: "synchronize",
      pullRequest: { ...event.pullRequest, branch: "feat/RF-05-refunds" },
    });

    expect(result).toMatchObject({ linkedTaskKeys: ["RF-04", "RF-05"], statusChanges: [] });
    expect(await linkedKeys()).toEqual(["RF-04", "RF-05"]);
    expect(await taskStatus("RF-04")).toBe("in_review");
    expect(await taskStatus("RF-05")).toBe("in_progress");
    const [pr] = await db.select({ branch: pullRequests.branch }).from(pullRequests);
    expect(pr?.branch).toBe("feat/RF-05-refunds");
  });

  it("rolls back every write when the transaction fails", async () => {
    await expect(
      store.transaction(async (tx) => {
        await tx.upsertPullRequest({
          repositoryId: 1,
          number: 8,
          title: "t",
          branch: "b",
          url: "u",
          authorGithubLogin: "a",
          state: "open",
          openedAt: new Date(),
          mergedAt: null,
          closedAt: null,
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.select().from(pullRequests)).toEqual([]);
  });

  describe("notifications", () => {
    const CHANNEL = "998877";
    let notifications: RecordingNotifications;

    const taskId = async (key: string) =>
      (await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.key, key)))[0]!.id;

    beforeEach(async () => {
      notifications = new RecordingNotifications();
      await db.update(projects).set({ discordChannelId: CHANNEL }).where(eq(projects.slug, "shop"));
    });

    it("announces the merge and the tasks it unblocked, once", async () => {
      const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, "shop"));
      await db.insert(tasks).values([
        { projectId: project!.id, key: "RF-10", title: "Checkout UI" },
        { projectId: project!.id, key: "RF-11", title: "Still blocked" },
      ]);
      await db.insert(taskDependencies).values([
        { taskId: await taskId("RF-10"), dependsOnTaskId: await taskId("RF-04") },
        { taskId: await taskId("RF-11"), dependsOnTaskId: await taskId("RF-04") },
        { taskId: await taskId("RF-11"), dependsOnTaskId: await taskId("RF-05") },
      ]);

      await handlePullRequestEvent(store, openedEvent(), notifications);
      await handlePullRequestEvent(store, mergedEvent(), notifications);
      await handlePullRequestEvent(store, mergedEvent(), notifications);

      expect(await taskStatus("RF-04")).toBe("done");
      expect(notifications.events).toEqual([
        expect.objectContaining({ type: "pull_request", action: "opened", channelId: CHANNEL, taskKeys: ["RF-04"] }),
        expect.objectContaining({ type: "pull_request", action: "merged", projectSlug: "shop", taskKeys: ["RF-04"] }),
        {
          type: "task_unblocked",
          channelId: CHANNEL,
          projectSlug: "shop",
          task: { key: "RF-10", title: "Checkout UI" },
          assigneeLogin: null,
        },
      ]);
    });

    it("stays silent for projects without a channel", async () => {
      await db.update(projects).set({ discordChannelId: null }).where(eq(projects.slug, "shop"));
      await handlePullRequestEvent(store, openedEvent(), notifications);
      await handlePullRequestEvent(store, mergedEvent(), notifications);
      expect(notifications.events).toEqual([]);
    });
  });
});
