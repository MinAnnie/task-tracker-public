import { normalizeProjectSlug, normalizeStageName } from "../domain/index.ts";
import type { StageRecord, StageStore } from "./stage-store.ts";

export interface StagesDeps {
  store: StageStore;
}

/** Request field that failed validation; `body` means the body is not a JSON object. */
export type StageField = "body" | "name" | "position";

type ProjectNotFound = { status: "project_not_found" };
type StageNotFound = { status: "stage_not_found" };
type Invalid = { status: "invalid"; field: StageField };
type StageTaken = { status: "stage_taken" };

export type ListStagesResult = { status: "ok"; stages: StageRecord[] } | ProjectNotFound;
export type CreateStageResult = { status: "created"; stage: StageRecord } | Invalid | StageTaken | ProjectNotFound;
export type UpdateStageResult =
  | { status: "ok"; stage: StageRecord }
  | Invalid
  | { status: "empty_update" }
  | StageTaken
  | ProjectNotFound
  | StageNotFound;
export type DeleteStageResult =
  | { status: "deleted" }
  | { status: "stage_in_use"; taskCount: number }
  | ProjectNotFound
  | StageNotFound;

const MAX_SERIAL_ID = 2_147_483_647;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A stage id from an untrusted path segment, or `undefined` when it cannot be one. */
function parseStageId(raw: string): number | undefined {
  const id = /^\d{1,10}$/.test(raw) ? Number(raw) : Number.NaN;
  return id >= 1 && id <= MAX_SERIAL_ID ? id : undefined;
}

/** Positions follow the list order, 0-based and without gaps. */
const withPositions = (stages: readonly StageRecord[]): StageRecord[] =>
  stages.map((stage, position) => ({ ...stage, position }));

/**
 * Runs `work` in a transaction with the project row locked, so stage writes serialize
 * with each other and with task writes that check the project's stages.
 */
async function withLockedProject<T>(
  store: StageStore,
  slug: string,
  work: (tx: StageStore, projectId: number) => Promise<T>,
): Promise<T | ProjectNotFound> {
  const normalized = normalizeProjectSlug(slug);
  if (normalized === undefined) return { status: "project_not_found" };
  return store.transaction(async (tx) => {
    const project = await tx.findProjectBySlug(normalized, { lock: true });
    if (project === undefined) return { status: "project_not_found" } as const;
    return work(tx, project.id);
  });
}

/** The project's stages in board order (admin view). */
export async function listStages({ store }: StagesDeps, slug: string): Promise<ListStagesResult> {
  const normalized = normalizeProjectSlug(slug);
  const project = normalized === undefined ? undefined : await store.findProjectBySlug(normalized);
  if (project === undefined) return { status: "project_not_found" };
  return { status: "ok", stages: await store.listStages(project.id) };
}

/** Appends a stage from an untrusted request body. */
export async function createStage({ store }: StagesDeps, slug: string, body: unknown): Promise<CreateStageResult> {
  const name = isObject(body) ? normalizeStageName(body.name) : undefined;
  if (name === undefined) return { status: "invalid", field: "name" };

  return withLockedProject(store, slug, async (tx, projectId): Promise<CreateStageResult> => {
    const stages = await tx.listStages(projectId);
    const stage = await tx.insertStage(projectId, name, stages.length);
    return stage === undefined ? { status: "stage_taken" } : { status: "created", stage };
  });
}

/**
 * Renames a stage (its tasks follow) and/or moves it to another 0-based `position`,
 * shifting the stages in between, from an untrusted request body.
 */
export async function updateStage(
  { store }: StagesDeps,
  slug: string,
  stageId: string,
  body: unknown,
): Promise<UpdateStageResult> {
  if (!isObject(body)) return { status: "invalid", field: "body" };
  let name: string | undefined;
  if ("name" in body) {
    name = normalizeStageName(body.name);
    if (name === undefined) return { status: "invalid", field: "name" };
  }
  const moves = "position" in body;
  const position = body.position;
  if (moves && !(typeof position === "number" && Number.isInteger(position) && position >= 0)) {
    return { status: "invalid", field: "position" };
  }
  if (name === undefined && !moves) return { status: "empty_update" };
  const id = parseStageId(stageId);

  return withLockedProject(store, slug, async (tx, projectId): Promise<UpdateStageResult> => {
    const stages = await tx.listStages(projectId);
    const stage = stages.find((s) => s.id === id);
    if (stage === undefined) return { status: "stage_not_found" };
    if (moves && (position as number) >= stages.length) return { status: "invalid", field: "position" };

    if (name !== undefined && name !== stage.name) {
      if (!(await tx.renameStage(projectId, stage.id, stage.name, name))) return { status: "stage_taken" };
    }
    let ordered = stages;
    if (moves) {
      const others = stages.filter((s) => s.id !== stage.id);
      ordered = [...others.slice(0, position as number), stage, ...others.slice(position as number)];
      await tx.setStagePositions(projectId, ordered.map((s) => s.id));
    }
    const updated = withPositions(ordered).find((s) => s.id === stage.id)!;
    return { status: "ok", stage: { ...updated, name: name ?? stage.name } };
  });
}

/** Deletes a stage no task uses; the remaining stages close the gap. */
export async function deleteStage({ store }: StagesDeps, slug: string, stageId: string): Promise<DeleteStageResult> {
  const id = parseStageId(stageId);
  return withLockedProject(store, slug, async (tx, projectId): Promise<DeleteStageResult> => {
    const stages = await tx.listStages(projectId);
    const stage = stages.find((s) => s.id === id);
    if (stage === undefined) return { status: "stage_not_found" };
    const taskCount = await tx.countStageTasks(projectId, stage.name);
    if (taskCount > 0) return { status: "stage_in_use", taskCount };
    await tx.deleteStage(stage.id);
    await tx.setStagePositions(
      projectId,
      stages.filter((s) => s.id !== stage.id).map((s) => s.id),
    );
    return { status: "deleted" };
  });
}
