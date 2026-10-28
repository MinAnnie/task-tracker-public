import type { StageRecord, StageStore } from "../../src/application/stage-store.ts";

interface StoredStage extends StageRecord {
  projectId: number;
}

/**
 * In-memory implementation of {@link StageStore}, mirroring the database constraints.
 * Projects and tasks (only what stages need) are seeded by tests.
 */
export class InMemoryStageStore implements StageStore {
  projects: { id: number; slug: string }[] = [];
  stages: StoredStage[] = [];
  tasks: { projectId: number; stage: string | null }[] = [];
  transactions = 0;
  /** Slugs locked through `findProjectBySlug(slug, { lock: true })`. */
  locks: string[] = [];
  private nextId = 1;

  async transaction<T>(work: (store: StageStore) => Promise<T>): Promise<T> {
    this.transactions += 1;
    return work(this);
  }

  async findProjectBySlug(slug: string, options: { lock?: boolean } = {}) {
    const project = this.projects.find((p) => p.slug === slug);
    if (project && options.lock) this.locks.push(slug);
    return project && { id: project.id };
  }

  async listStages(projectId: number): Promise<StageRecord[]> {
    return this.stages
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => a.position - b.position || a.id - b.id)
      .map(({ id, name, position }) => ({ id, name, position }));
  }

  async insertStage(projectId: number, name: string, position: number) {
    if (this.taken(projectId, name, undefined)) return undefined;
    const stage = { id: this.nextId++, projectId, name, position };
    this.stages.push(stage);
    return { id: stage.id, name, position };
  }

  async renameStage(projectId: number, stageId: number, oldName: string, newName: string) {
    if (this.taken(projectId, newName, stageId)) return false;
    this.stage(stageId).name = newName;
    for (const task of this.tasks) {
      if (task.projectId === projectId && task.stage?.toLowerCase() === oldName.toLowerCase()) task.stage = newName;
    }
    return true;
  }

  async setStagePositions(projectId: number, stageIds: readonly number[]) {
    stageIds.forEach((id, position) => {
      const stage = this.stage(id);
      if (stage.projectId !== projectId) throw new Error("stage of another project");
      stage.position = position;
    });
  }

  async deleteStage(stageId: number) {
    this.stage(stageId);
    this.stages = this.stages.filter((s) => s.id !== stageId);
  }

  async countStageTasks(projectId: number, name: string) {
    return this.tasks.filter((t) => t.projectId === projectId && t.stage?.toLowerCase() === name.toLowerCase())
      .length;
  }

  /** Test helper: the project's stage names in order. */
  names(projectId: number): string[] {
    return this.stages
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => a.position - b.position || a.id - b.id)
      .map((s) => s.name);
  }

  private stage(stageId: number): StoredStage {
    const stage = this.stages.find((s) => s.id === stageId);
    if (stage === undefined) throw new Error("unknown stage");
    return stage;
  }

  private taken(projectId: number, name: string, exceptId: number | undefined) {
    return this.stages.some(
      (s) => s.projectId === projectId && s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase(),
    );
  }
}
