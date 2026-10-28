import { and, asc, eq, sql } from "drizzle-orm";
import type { StageRecord, StageStore } from "../application/stage-store.ts";
import * as schema from "../db/schema.ts";
import type { Executor } from "./drizzle-auth-store.ts";
import { uniqueViolation } from "./drizzle-project-store.ts";

const { projects, projectStages, tasks } = schema;

const STAGE_NAME_UNIQUE = "project_stages_project_id_name_unique";

const stageColumns = { id: projectStages.id, name: projectStages.name, position: projectStages.position };

/**
 * Runs a write that may collide with another stage's name, resolving `undefined` on that
 * collision. The write runs in its own (nested, i.e. savepoint) transaction, so the
 * caller's transaction stays usable.
 */
async function unlessNameTaken<T>(db: Executor, write: (tx: Executor) => Promise<T>): Promise<T | undefined> {
  try {
    return await db.transaction((tx) => write(tx));
  } catch (error) {
    if (uniqueViolation(error) === STAGE_NAME_UNIQUE) return undefined;
    throw error;
  }
}

/** Postgres adapter for {@link StageStore} built on Drizzle. */
export function createDrizzleStageStore(db: Executor): StageStore {
  return {
    transaction: (work) => db.transaction((tx) => work(createDrizzleStageStore(tx))),

    async findProjectBySlug(slug, { lock = false } = {}) {
      const query = db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).limit(1);
      const [row] = lock ? await query.for("update") : await query;
      return row;
    },

    listStages: (projectId) => listProjectStages(db, projectId),

    insertStage: (projectId, name, position) =>
      unlessNameTaken(db, async (tx) => {
        const [row] = await tx.insert(projectStages).values({ projectId, name, position }).returning(stageColumns);
        if (row === undefined) throw new Error("Stage insert returned no row");
        return row;
      }),

    async renameStage(projectId, stageId, oldName, newName) {
      const renamed = await unlessNameTaken(db, async (tx) => {
        await tx.update(projectStages).set({ name: newName }).where(eq(projectStages.id, stageId));
        await tx
          .update(tasks)
          .set({ stage: newName })
          .where(and(eq(tasks.projectId, projectId), eq(sql`lower(${tasks.stage})`, oldName.toLowerCase())));
        return true;
      });
      return renamed ?? false;
    },

    async setStagePositions(projectId, stageIds) {
      for (const [position, id] of stageIds.entries()) {
        await db
          .update(projectStages)
          .set({ position })
          .where(and(eq(projectStages.id, id), eq(projectStages.projectId, projectId)));
      }
    },

    async deleteStage(stageId) {
      await db.delete(projectStages).where(eq(projectStages.id, stageId));
    },

    async countStageTasks(projectId, name) {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), eq(sql`lower(${tasks.stage})`, name.toLowerCase())));
      return row?.count ?? 0;
    },
  };
}

/** The project's stages ordered by position, then id. */
export function listProjectStages(db: Executor, projectId: number): Promise<StageRecord[]> {
  return db
    .select(stageColumns)
    .from(projectStages)
    .where(eq(projectStages.projectId, projectId))
    .orderBy(asc(projectStages.position), asc(projectStages.id));
}
