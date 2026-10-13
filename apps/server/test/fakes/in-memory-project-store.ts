import type {
  NewProject,
  ProjectChanges,
  ProjectMemberRecord,
  ProjectRecord,
  ProjectRef,
  ProjectRepositoryRecord,
  ProjectStore,
  ProjectSummary,
  ProjectWriteResult,
} from "../../src/application/project-store.ts";
import type { TaskStatus } from "../../src/domain/index.ts";

interface StoredProject extends ProjectRecord {
  nextTaskNumber: number;
}

interface StoredRepository extends ProjectRepositoryRecord {
  id: number;
  projectId: number;
}

interface StoredProjectMember {
  projectId: number;
  memberId: number;
  createdAt: Date;
}

export interface StoredTask {
  id: number;
  projectId: number;
  status: TaskStatus;
  assigneeId: number | null;
}

/**
 * In-memory implementation of {@link ProjectStore}, mirroring the database
 * constraints and cascades. `members`, `users` and `tasks` are seeded by tests.
 */
export class InMemoryProjectStore implements ProjectStore {
  projects: StoredProject[] = [];
  repositories: StoredRepository[] = [];
  members: { id: number; githubLogin: string }[] = [];
  users: { id: number; githubLogin: string }[] = [];
  projectMembers: StoredProjectMember[] = [];
  tasks: StoredTask[] = [];
  transactions = 0;
  /** Slugs locked through `findProjectBySlug(slug, { lock: true })`. */
  locks: string[] = [];
  /** Clock used for `created_at` defaults. */
  now: () => Date = () => new Date();
  private nextId = 1;

  async transaction<T>(work: (store: ProjectStore) => Promise<T>): Promise<T> {
    this.transactions += 1;
    return work(this);
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return this.sortedProjects().map((project) => ({
      ...this.toRecord(project),
      repositoryCount: this.repositories.filter((r) => r.projectId === project.id).length,
      taskCount: this.tasks.filter((t) => t.projectId === project.id).length,
      memberCount: this.projectMembers.filter((m) => m.projectId === project.id).length,
    }));
  }

  async listAllProjectRefs(): Promise<ProjectRef[]> {
    return this.sortedProjects().map(toRef);
  }

  async listProjectRefsForMember(githubLogin: string): Promise<ProjectRef[]> {
    const member = this.members.find((m) => m.githubLogin === githubLogin);
    return this.sortedProjects()
      .filter((p) =>
        this.projectMembers.some((pm) => pm.projectId === p.id && pm.memberId === member?.id),
      )
      .map(toRef);
  }

  async findProjectBySlug(slug: string, options: { lock?: boolean } = {}) {
    const project = this.projects.find((p) => p.slug === slug);
    if (project && options.lock) this.locks.push(slug);
    return project && this.toRecord(project);
  }

  async findProjectByDiscordChannelId(channelId: string) {
    const project = this.sortedProjects().find((p) => p.discordChannelId === channelId);
    return project && this.toRecord(project);
  }

  async createProject(project: NewProject): Promise<ProjectWriteResult> {
    const conflict = this.conflictFor(project, undefined);
    if (conflict) return conflict;
    const stored: StoredProject = {
      ...project,
      id: this.nextId++,
      createdAt: this.now(),
      nextTaskNumber: 1,
    };
    this.projects.push(stored);
    return { status: "saved", project: this.toRecord(stored) };
  }

  async updateProject(projectId: number, changes: ProjectChanges): Promise<ProjectWriteResult> {
    const project = this.projects.find((p) => p.id === projectId);
    if (project === undefined) throw new Error("unknown project");
    const conflict = this.conflictFor(changes, projectId);
    if (conflict) return conflict;
    Object.assign(project, changes);
    return { status: "saved", project: this.toRecord(project) };
  }

  async deleteProject(projectId: number) {
    this.projects = this.projects.filter((p) => p.id !== projectId);
    this.repositories = this.repositories.filter((r) => r.projectId !== projectId);
    this.projectMembers = this.projectMembers.filter((m) => m.projectId !== projectId);
    this.tasks = this.tasks.filter((t) => t.projectId !== projectId);
  }

  async countProjectTasks(projectId: number) {
    return this.tasks.filter((t) => t.projectId === projectId).length;
  }

  async listProjectRepositories(projectId: number): Promise<ProjectRepositoryRecord[]> {
    return this.repositories
      .filter((r) => r.projectId === projectId)
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .map(({ fullName, githubInstallationId }) => ({ fullName, githubInstallationId }));
  }

  async addRepository(projectId: number, fullName: string) {
    this.assertProject(projectId);
    if (this.repositories.some((r) => r.fullName === fullName)) return undefined;
    const repository = { id: this.nextId++, projectId, fullName, githubInstallationId: null };
    this.repositories.push(repository);
    return { fullName, githubInstallationId: null };
  }

  async removeRepository(projectId: number, fullName: string) {
    const before = this.repositories.length;
    this.repositories = this.repositories.filter(
      (r) => !(r.projectId === projectId && r.fullName === fullName),
    );
    return this.repositories.length < before;
  }

  async listProjectMembers(projectId: number): Promise<ProjectMemberRecord[]> {
    return this.projectMembers
      .filter((pm) => pm.projectId === projectId)
      .map((pm) => ({
        githubLogin: this.members.find((m) => m.id === pm.memberId)?.githubLogin ?? "",
        createdAt: pm.createdAt,
      }))
      .sort((a, b) => a.githubLogin.localeCompare(b.githubLogin));
  }

  async findMemberIdByGithubLogin(githubLogin: string) {
    return this.members.find((m) => m.githubLogin === githubLogin)?.id;
  }

  async addProjectMember(projectId: number, memberId: number) {
    this.assertProject(projectId);
    if (!this.members.some((m) => m.id === memberId)) throw new Error("unknown member");
    if (this.projectMembers.some((pm) => pm.projectId === projectId && pm.memberId === memberId)) {
      return undefined;
    }
    const createdAt = this.now();
    this.projectMembers.push({ projectId, memberId, createdAt });
    return { createdAt };
  }

  async removeProjectMember(projectId: number, githubLogin: string) {
    const memberId = this.members.find((m) => m.githubLogin === githubLogin)?.id;
    const before = this.projectMembers.length;
    this.projectMembers = this.projectMembers.filter(
      (pm) => !(pm.projectId === projectId && pm.memberId === memberId),
    );
    return this.projectMembers.length < before;
  }

  async unassignOpenProjectTasks(projectId: number, githubLogin: string) {
    const userIds = new Set(
      this.users
        .filter((u) => u.githubLogin.toLowerCase() === githubLogin.toLowerCase())
        .map((u) => u.id),
    );
    for (const task of this.tasks) {
      if (
        task.projectId === projectId &&
        task.status !== "done" &&
        task.assigneeId !== null &&
        userIds.has(task.assigneeId)
      ) {
        task.assigneeId = null;
        if (task.status === "in_progress") task.status = "todo";
      }
    }
  }

  private sortedProjects() {
    return [...this.projects].sort((a, b) => a.slug.localeCompare(b.slug));
  }

  private toRecord({ nextTaskNumber: _, ...record }: StoredProject): ProjectRecord {
    return { ...record };
  }

  private assertProject(projectId: number) {
    if (!this.projects.some((p) => p.id === projectId)) throw new Error("unknown project");
  }

  private conflictFor(
    values: ProjectChanges,
    exceptId: number | undefined,
  ): ProjectWriteResult | undefined {
    const others = this.projects.filter((p) => p.id !== exceptId);
    if (values.slug !== undefined && others.some((p) => p.slug === values.slug)) {
      return { status: "conflict", field: "slug" };
    }
    if (
      values.taskKeyPrefix !== undefined &&
      others.some((p) => p.taskKeyPrefix === values.taskKeyPrefix)
    ) {
      return { status: "conflict", field: "taskKeyPrefix" };
    }
    return undefined;
  }
}

const toRef = ({ id, slug, name, taskKeyPrefix }: ProjectRecord): ProjectRef => ({
  id,
  slug,
  name,
  taskKeyPrefix,
});
