/** A stage of a project, as stored. */
export interface StageRecord {
  id: number;
  /** 1–50 characters, trimmed; unique in the project case-insensitively. */
  name: string;
  /** 0-based board order within the project. */
  position: number;
}

/** Persistence port for the configurable stages of a project. */
export interface StageStore {
  /** Runs `work` atomically; the callback receives a store bound to the transaction. */
  transaction<T>(work: (store: StageStore) => Promise<T>): Promise<T>;
  /**
   * Finds a project by lowercased slug. With `lock`, the row stays locked until the
   * surrounding transaction ends, serializing every stage write of the project with
   * task writes that check stages.
   */
  findProjectBySlug(slug: string, options?: { lock?: boolean }): Promise<{ id: number } | undefined>;
  /** The project's stages ordered by position, then id. */
  listStages(projectId: number): Promise<StageRecord[]>;
  /** Adds a stage; resolves `undefined` without changes when the project already has the name. */
  insertStage(projectId: number, name: string, position: number): Promise<StageRecord | undefined>;
  /**
   * Renames a stage and rewrites the stage of every project task that matched the old
   * name (case-insensitively) to the new one. Resolves `false` without changes when
   * another stage of the project already has the new name.
   */
  renameStage(projectId: number, stageId: number, oldName: string, newName: string): Promise<boolean>;
  /** Sets each stage's position to its index in `stageIds` (every stage of the project). */
  setStagePositions(projectId: number, stageIds: readonly number[]): Promise<void>;
  deleteStage(stageId: number): Promise<void>;
  /** How many tasks of the project are in the stage named `name` (case-insensitively). */
  countStageTasks(projectId: number, name: string): Promise<number>;
}
