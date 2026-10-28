import { asc, sql as rawSql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/integration/database-url.ts";
import { RecordingNotifications } from "../../test/fakes/recording-notifications.ts";
import type { AuthenticatedUser } from "../application/sessions.ts";
import { createStage, deleteStage, listStages, updateStage } from "../application/stages.ts";
import { createTask, listProjectStages, updateTask } from "../application/tasks.ts";
import { createDb } from "../db/client.ts";
import { projects, projectStages, tasks } from "../db/schema.ts";
import { createDrizzleStageStore } from "./drizzle-stage-store.ts";
import { createDrizzleTaskStore } from "./drizzle-task-store.ts";

const { sql, db } = createDb(testDatabaseUrl);
const stagesDeps = { store: createDrizzleStageStore(db) };
const tasksDeps = { store: createDrizzleTaskStore(db), adminLogins: ["octocat"], notifications: new RecordingNotifications() };
const admin: AuthenticatedUser = { id: 1, githubLogin: "octocat", name: null, avatarUrl: null, role: "admin" };

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

const names = async (projectId: number) =>
  (
    await db
      .select({ name: projectStages.name, projectId: projectStages.projectId })
      .from(projectStages)
      .orderBy(asc(projectStages.position), asc(projectStages.id))
  )
    .filter((row) => row.projectId === projectId)
    .map((row) => row.name);

const stageId = async (name: string) => {
  const result = await listStages(stagesDeps, "shop");
  if (result.status !== "ok") throw new Error("no project");
  const stage = result.stages.find((s) => s.name === name);
  if (stage === undefined) throw new Error(`no stage ${name}`);
  return String(stage.id);
};

describe("createDrizzleStageStore (Postgres)", () => {
  let shopId: number;
  let blogId: number;

  beforeEach(async () => {
    await db.execute(rawSql`truncate table project_stages, tasks, projects restart identity cascade`);
    const [shop, blog] = await db
      .insert(projects)
      .values([
        { slug: "shop", name: "Shop", taskKeyPrefix: "RF" },
        { slug: "blog", name: "Blog", taskKeyPrefix: "BL" },
      ])
      .returning({ id: projects.id });
    shopId = shop!.id;
    blogId = blog!.id;
  });

  it("appends stages and refuses a name the project has, case-insensitively", async () => {
    expect(await createStage(stagesDeps, "shop", { name: "Backend" })).toEqual({
      status: "created",
      stage: { id: expect.any(Number), name: "Backend", position: 0 },
    });
    await createStage(stagesDeps, "shop", { name: "Frontend" });
    expect(await createStage(stagesDeps, "shop", { name: "BACKEND" })).toEqual({ status: "stage_taken" });
    expect(await createStage(stagesDeps, "blog", { name: "backend" })).toMatchObject({ status: "created" });

    expect(await names(shopId)).toEqual(["Backend", "Frontend"]);
    expect(await names(blogId)).toEqual(["backend"]);
  });

  it("renames a stage and its tasks in one go, and refuses a taken name", async () => {
    await createStage(stagesDeps, "shop", { name: "Backend" });
    await createStage(stagesDeps, "shop", { name: "Frontend" });
    await db.insert(tasks).values([
      { projectId: shopId, key: "RF-1", title: "a", stage: "Backend" },
      { projectId: shopId, key: "RF-2", title: "b", stage: "backend" },
      { projectId: shopId, key: "RF-3", title: "c", stage: "Frontend" },
      { projectId: blogId, key: "BL-1", title: "d", stage: "Backend" },
    ]);

    expect(await updateStage(stagesDeps, "shop", await stageId("Backend"), { name: "API" })).toMatchObject({
      status: "ok",
      stage: { name: "API", position: 0 },
    });
    const stages = await db.select({ key: tasks.key, stage: tasks.stage }).from(tasks).orderBy(asc(tasks.key));
    expect(stages).toEqual([
      { key: "BL-1", stage: "Backend" },
      { key: "RF-1", stage: "API" },
      { key: "RF-2", stage: "API" },
      { key: "RF-3", stage: "Frontend" },
    ]);

    expect(await updateStage(stagesDeps, "shop", await stageId("API"), { name: "frontend" })).toEqual({
      status: "stage_taken",
    });
    expect(await names(shopId)).toEqual(["API", "Frontend"]);
  });

  it("moves stages and closes gaps on delete", async () => {
    for (const name of ["A", "B", "C"]) await createStage(stagesDeps, "shop", { name });
    await updateStage(stagesDeps, "shop", await stageId("C"), { position: 0 });
    expect(await names(shopId)).toEqual(["C", "A", "B"]);

    expect(await deleteStage(stagesDeps, "shop", await stageId("A"))).toEqual({ status: "deleted" });
    expect(await listStages(stagesDeps, "shop")).toMatchObject({
      stages: [
        { name: "C", position: 0 },
        { name: "B", position: 1 },
      ],
    });
  });

  it("refuses to delete a stage in use, with the task count", async () => {
    await createStage(stagesDeps, "shop", { name: "Backend" });
    await db.insert(tasks).values([
      { projectId: shopId, key: "RF-1", title: "a", stage: "Backend" },
      { projectId: shopId, key: "RF-2", title: "b", stage: "BACKEND" },
    ]);
    expect(await deleteStage(stagesDeps, "shop", await stageId("Backend"))).toEqual({
      status: "stage_in_use",
      taskCount: 2,
    });
  });

  it("lets tasks use only the project's stages, stored with their canonical name", async () => {
    await createStage(stagesDeps, "shop", { name: "Backend" });
    await createStage(stagesDeps, "blog", { name: "Design" });

    expect(await listProjectStages(tasksDeps, admin, "shop")).toEqual({
      status: "ok",
      stages: [{ id: expect.any(Number), name: "Backend", position: 0 }],
    });
    expect(await createTask(tasksDeps, admin, "shop", { title: "X", stage: "backend" })).toMatchObject({
      status: "created",
      task: { stage: "Backend" },
    });
    expect(await createTask(tasksDeps, admin, "shop", { title: "Y", stage: "Design" })).toEqual({
      status: "invalid_stage",
    });
    expect(await updateTask(tasksDeps, admin, "shop", "RF-1", { stage: "Design" })).toEqual({
      status: "invalid_stage",
    });
    expect(await updateTask(tasksDeps, admin, "shop", "RF-1", { stage: null })).toMatchObject({
      status: "ok",
      task: { stage: null },
    });
  });

  it("cascades stages when the project is deleted", async () => {
    await createStage(stagesDeps, "shop", { name: "Backend" });
    await db.execute(rawSql`delete from projects where slug = 'shop'`);
    expect(await db.select().from(projectStages)).toEqual([]);
  });
});
