import type {
  NewTask,
  TaskChanges,
  TaskLinkRecord,
  TaskProjectRecord,
  TaskPullRequestRecord,
  TaskRecord,
  TaskStore,
  TaskUserRecord,
} from "../../src/application/task-store.ts";
import {
  compareTaskKeys,
  isDependencyPending,
  type TaskDependencyEdge,
  type TaskPriority,
  type TaskStatus,
} from "../../src/domain/index.ts";

export interface StoredTask {
  id: number;
  projectId: number;
  key: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  stage: string | null;
  assigneeId: number | null;
}

/**
 * In-memory implementation of {@link TaskStore}, mirroring the database constraints.
 * Projects, members, users and pull requests are seeded by tests.
 */
export class InMemoryTaskStore implements TaskStore {
  projects: TaskProjectRecord[] = [];
  /** Lowercased member logins per project id. */
  projectMembers: { projectId: number; githubLogin: string }[] = [];
  users: TaskUserRecord[] = [];
  /** Linked Discord user ids per user id. */
  discordUserIds = new Map<number, string>();
  tasks: StoredTask[] = [];
  dependencies: TaskDependencyEdge[] = [];
  pullRequests: TaskPullRequestRecord[] = [];
  transactions = 0;
  /** Slugs locked through `findProjectBySlug(slug, { lock: true })`. */
  projectLocks: string[] = [];
  /** Keys locked through `findTaskByKey(projectId, key, { lock: true })`. */
  taskLocks: string[] = [];
  private nextId = 1000;

  async transaction<T>(work: (store: TaskStore) => Promise<T>): Promise<T> {
    this.transactions += 1;
    return work(this);
  }

  async findProjectBySlug(slug: string, options: { lock?: boolean } = {}) {
    const project = this.projects.find((p) => p.slug === slug);
    if (project && options.lock) this.projectLocks.push(slug);
    return project && { ...project };
  }

  async isProjectMember(projectId: number, githubLogin: string) {
    return this.projectMembers.some((m) => m.projectId === projectId && m.githubLogin === githubLogin);
  }

  async findUserByGithubLogin(githubLogin: string) {
    return this.users
      .filter((u) => u.githubLogin.toLowerCase() === githubLogin.toLowerCase())
      .sort((a, b) => b.id - a.id)[0];
  }

  async findDiscordUserId(userId: number) {
    return this.discordUserIds.get(userId) ?? null;
  }

  async listProjectMemberLogins(projectId: number) {
    return this.projectMembers.filter((m) => m.projectId === projectId).map((m) => m.githubLogin);
  }

  async findUsersByGithubLogins(githubLogins: readonly string[]) {
    const found = await Promise.all(githubLogins.map((login) => this.findUserByGithubLogin(login)));
    return found.filter((user) => user !== undefined).map((user) => ({ ...user }));
  }

  async listProjectTaskKeys(projectId: number) {
    return this.tasks.filter((t) => t.projectId === projectId).map((t) => t.key);
  }

  async setNextTaskNumber(projectId: number, nextTaskNumber: number) {
    const project = this.projects.find((p) => p.id === projectId);
    if (project === undefined) throw new Error("unknown project");
    project.nextTaskNumber = nextTaskNumber;
  }

  async insertTask(task: NewTask) {
    if (this.tasks.some((t) => t.projectId === task.projectId && t.key === task.key)) {
      throw new Error(`duplicate key value violates unique constraint (${task.key})`);
    }
    const id = this.nextId++;
    this.tasks.push({ ...task, id });
    return { id };
  }

  async listProjectTasks(projectId: number): Promise<TaskRecord[]> {
    return this.tasks.filter((t) => t.projectId === projectId).map((t) => this.toRecord(t));
  }

  async listProjectDependencies(projectId: number) {
    const ids = new Set(this.tasks.filter((t) => t.projectId === projectId).map((t) => t.id));
    return this.dependencies.filter((d) => ids.has(d.taskId)).map((d) => ({ ...d }));
  }

  async listProjectPullRequests(projectId: number) {
    const ids = new Set(this.tasks.filter((t) => t.projectId === projectId).map((t) => t.id));
    return this.pullRequests.filter((pr) => ids.has(pr.taskId)).sort((a, b) => a.number - b.number);
  }

  async findTaskByKey(projectId: number, key: string, options: { lock?: boolean } = {}) {
    const candidates = this.tasks.filter(
      (t) => t.projectId === projectId && t.key.toLowerCase() === key.toLowerCase(),
    );
    const task = candidates.find((t) => t.key === key) ?? candidates[0];
    if (task && options.lock) this.taskLocks.push(task.key);
    return task && this.toRecord(task);
  }

  async listDependencies(taskId: number) {
    return this.links(this.dependencies.filter((d) => d.taskId === taskId).map((d) => d.dependsOnTaskId));
  }

  async listDependents(taskId: number) {
    return this.links(this.dependencies.filter((d) => d.dependsOnTaskId === taskId).map((d) => d.taskId));
  }

  async listTaskPullRequests(taskId: number) {
    return this.pullRequests.filter((pr) => pr.taskId === taskId).sort((a, b) => a.number - b.number);
  }

  async updateTask(taskId: number, changes: TaskChanges) {
    Object.assign(this.task(taskId), changes);
  }

  async takeTask(taskId: number, userId: number) {
    const task = this.task(taskId);
    const blocked = this.dependencies.some(
      (d) => d.taskId === taskId && isDependencyPending(this.task(d.dependsOnTaskId).status),
    );
    if (task.assigneeId !== null || task.status === "done" || blocked) return false;
    task.assigneeId = userId;
    if (task.status === "todo") task.status = "in_progress";
    return true;
  }

  async addDependency(taskId: number, dependsOnTaskId: number) {
    if (taskId === dependsOnTaskId) throw new Error("violates check constraint task_dependencies_not_self");
    this.task(taskId);
    this.task(dependsOnTaskId);
    if (this.dependencies.some((d) => d.taskId === taskId && d.dependsOnTaskId === dependsOnTaskId)) {
      return false;
    }
    this.dependencies.push({ taskId, dependsOnTaskId });
    return true;
  }

  async removeDependency(taskId: number, dependsOnTaskId: number) {
    const before = this.dependencies.length;
    this.dependencies = this.dependencies.filter(
      (d) => !(d.taskId === taskId && d.dependsOnTaskId === dependsOnTaskId),
    );
    return this.dependencies.length < before;
  }

  async findUnblockedDependents(taskIds: readonly number[]) {
    const dependentIds = new Set(
      this.dependencies.filter((d) => taskIds.includes(d.dependsOnTaskId)).map((d) => d.taskId),
    );
    return this.tasks
      .filter((t) => dependentIds.has(t.id) && t.status !== "done")
      .filter(
        (t) =>
          !this.dependencies.some(
            (d) => d.taskId === t.id && isDependencyPending(this.task(d.dependsOnTaskId).status),
          ),
      )
      .sort((a, b) => a.id - b.id)
      .map((t) => {
        this.taskLocks.push(t.key);
        return this.toRecord(t);
      });
  }

  async lockDependents(taskId: number) {
    return this.dependencies
      .filter((d) => d.dependsOnTaskId === taskId)
      .map((d) => this.task(d.taskId))
      .sort((a, b) => a.id - b.id)
      .map((t) => {
        this.taskLocks.push(t.key);
        return t.id;
      });
  }

  async findUnblockedTasks(taskIds: readonly number[]) {
    return this.tasks
      .filter((t) => taskIds.includes(t.id) && t.status !== "done")
      .filter(
        (t) =>
          !this.dependencies.some(
            (d) => d.taskId === t.id && isDependencyPending(this.task(d.dependsOnTaskId).status),
          ),
      )
      .sort((a, b) => a.id - b.id)
      .map((t) => this.toRecord(t));
  }

  /** Mirrors the `on delete cascade` foreign keys of dependency edges and pull request links. */
  async deleteTask(taskId: number) {
    this.task(taskId);
    this.tasks = this.tasks.filter((t) => t.id !== taskId);
    this.dependencies = this.dependencies.filter((d) => d.taskId !== taskId && d.dependsOnTaskId !== taskId);
    this.pullRequests = this.pullRequests.filter((pr) => pr.taskId !== taskId);
  }

  /** Test helper: the stored task with this exact key. */
  byKey(key: string): StoredTask {
    const task = this.tasks.find((t) => t.key === key);
    if (task === undefined) throw new Error(`unknown task ${key}`);
    return task;
  }

  private task(taskId: number): StoredTask {
    const task = this.tasks.find((t) => t.id === taskId);
    if (task === undefined) throw new Error("unknown task");
    return task;
  }

  private links(taskIds: number[]): TaskLinkRecord[] {
    return taskIds
      .map((id) => this.task(id))
      .map(({ id, key, title, status }) => ({ id, key, title, status }))
      .sort((a, b) => compareTaskKeys(a.key, b.key));
  }

  private toRecord({ projectId: _, assigneeId, ...task }: StoredTask): TaskRecord {
    const assignee = assigneeId === null ? null : this.users.find((u) => u.id === assigneeId) ?? null;
    return { ...task, assignee: assignee && { ...assignee } };
  }
}
