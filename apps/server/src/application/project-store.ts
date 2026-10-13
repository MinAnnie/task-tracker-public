/** A project as stored. */
export interface ProjectRecord {
  id: number;
  /** Lowercased, URL-safe identifier. */
  slug: string;
  name: string;
  /** Uppercased prefix of the project's task keys (`RF` in `RF-14`). */
  taskKeyPrefix: string;
  discordChannelId: string | null;
  createdAt: Date;
}

/** A project with the sizes shown in the admin list. */
export interface ProjectSummary extends ProjectRecord {
  repositoryCount: number;
  taskCount: number;
  memberCount: number;
}

/** The minimal project view exposed to every signed-in user. */
export interface ProjectRef {
  id: number;
  slug: string;
  name: string;
  taskKeyPrefix: string;
}

export interface ProjectRepositoryRecord {
  /** Lowercased `owner/repo`. */
  fullName: string;
  githubInstallationId: number | null;
}

/** A member (from the `members` table) granted access to one project. */
export interface ProjectMemberRecord {
  /** Lowercased GitHub login. */
  githubLogin: string;
  /** When the member was added to the project. */
  createdAt: Date;
}

export interface NewProject {
  slug: string;
  name: string;
  taskKeyPrefix: string;
  discordChannelId: string | null;
}

export type ProjectChanges = Partial<NewProject>;

/**
 * Outcome of a write touching the unique columns: either the stored project or
 * which unique column collided with another project.
 */
export type ProjectWriteResult =
  | { status: "saved"; project: ProjectRecord }
  | { status: "conflict"; field: "slug" | "taskKeyPrefix" };

/** Persistence port for projects, their repositories and their members. */
export interface ProjectStore {
  /** Runs `work` atomically; the callback receives a store bound to the transaction. */
  transaction<T>(work: (store: ProjectStore) => Promise<T>): Promise<T>;
  /** All projects with repository, task and member counts, ordered by slug. */
  listProjects(): Promise<ProjectSummary[]>;
  /** Every project, ordered by slug. */
  listAllProjectRefs(): Promise<ProjectRef[]>;
  /** Projects the member with this lowercased login belongs to, ordered by slug. */
  listProjectRefsForMember(githubLogin: string): Promise<ProjectRef[]>;
  /**
   * Finds a project by lowercased slug. With `lock`, the row stays locked until the
   * surrounding transaction ends, serializing writers of the same project.
   */
  findProjectBySlug(slug: string, options?: { lock?: boolean }): Promise<ProjectRecord | undefined>;
  /**
   * The project posting to this Discord channel; when several share it, the first by slug.
   */
  findProjectByDiscordChannelId(channelId: string): Promise<ProjectRecord | undefined>;
  createProject(project: NewProject): Promise<ProjectWriteResult>;
  /** Applies `changes` to an existing project. */
  updateProject(projectId: number, changes: ProjectChanges): Promise<ProjectWriteResult>;
  /** Deletes a project and, by cascade, its repositories, tasks and memberships. */
  deleteProject(projectId: number): Promise<void>;
  countProjectTasks(projectId: number): Promise<number>;
  /** Repositories of a project, ordered by full name. */
  listProjectRepositories(projectId: number): Promise<ProjectRepositoryRecord[]>;
  /** Links a repository; resolves `undefined` without changes when any project already has it. */
  addRepository(projectId: number, fullName: string): Promise<ProjectRepositoryRecord | undefined>;
  /** Unlinks a repository from the project; resolves whether it was linked to it. */
  removeRepository(projectId: number, fullName: string): Promise<boolean>;
  /** Members of a project, ordered by login. */
  listProjectMembers(projectId: number): Promise<ProjectMemberRecord[]>;
  /** Id of the app member with this lowercased login. */
  findMemberIdByGithubLogin(githubLogin: string): Promise<number | undefined>;
  /** Adds a member to a project; resolves `undefined` without changes when already in it. */
  addProjectMember(projectId: number, memberId: number): Promise<{ createdAt: Date } | undefined>;
  /** Removes the member with this lowercased login from a project; resolves whether they were in it. */
  removeProjectMember(projectId: number, githubLogin: string): Promise<boolean>;
  /**
   * Clears the assignee of the project's tasks that are not `done` and are assigned
   * to a user whose login matches `githubLogin` case-insensitively.
   * Unassigned `in_progress` tasks go back to `todo`; other statuses stay.
   */
  unassignOpenProjectTasks(projectId: number, githubLogin: string): Promise<void>;
}
