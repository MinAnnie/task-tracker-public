import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type {
  ProjectRecord,
  ProjectStore,
  ProjectWriteResult,
} from "../application/project-store.ts";
import * as schema from "../db/schema.ts";
import { inProgressBackToTodo, usersMatchingLogin, type Executor } from "./drizzle-auth-store.ts";

const { members, projectMembers, projects, repositories, tasks } = schema;

const projectColumns = {
  id: projects.id,
  slug: projects.slug,
  name: projects.name,
  taskKeyPrefix: projects.taskKeyPrefix,
  discordChannelId: projects.discordChannelId,
  createdAt: projects.createdAt,
};

const refColumns = {
  id: projects.id,
  slug: projects.slug,
  name: projects.name,
  taskKeyPrefix: projects.taskKeyPrefix,
};

/** Unique constraints of `projects` (named by drizzle-kit) and the field each guards. */
const UNIQUE_FIELDS: Record<string, "slug" | "taskKeyPrefix"> = {
  projects_slug_unique: "slug",
  projects_task_key_prefix_unique: "taskKeyPrefix",
};

/** Name of the violated constraint when `error` (or its cause) is a Postgres unique violation. */
function uniqueViolation(error: unknown): string | undefined {
  for (let current = error; typeof current === "object" && current !== null; ) {
    const { code, constraint_name: constraint, cause } = current as {
      code?: unknown;
      constraint_name?: unknown;
      cause?: unknown;
    };
    if (code === "23505" && typeof constraint === "string") return constraint;
    current = cause;
  }
  return undefined;
}

/**
 * Runs a project write, turning unique violations on slug or prefix into a conflict
 * result. The write runs in its own (nested, i.e. savepoint) transaction, so a
 * violation inside a caller's transaction leaves that transaction usable.
 */
async function saveProject(
  db: Executor,
  write: (tx: Executor) => Promise<ProjectRecord[]>,
): Promise<ProjectWriteResult> {
  try {
    const [project] = await db.transaction((tx) => write(tx));
    if (project === undefined) throw new Error("Project write returned no row");
    return { status: "saved", project };
  } catch (error) {
    const field = UNIQUE_FIELDS[uniqueViolation(error) ?? ""];
    if (field === undefined) throw error;
    return { status: "conflict", field };
  }
}

/**
 * Correlated count of a table's rows that belong to the outer `projects` row. Columns
 * are qualified by hand: Drizzle renders `sql` column references unqualified, which
 * would resolve `id` against the inner table.
 */
const count = (table: "repositories" | "tasks" | "project_members") =>
  sql<number>`(select count(*) from ${sql.identifier(table)} as counted where counted.project_id = ${sql.identifier("projects")}.id)::int`;

/** Postgres adapter for {@link ProjectStore} built on Drizzle. */
export function createDrizzleProjectStore(db: Executor): ProjectStore {
  return {
    transaction: (work) => db.transaction((tx) => work(createDrizzleProjectStore(tx))),

    listProjects: () =>
      db
        .select({
          ...projectColumns,
          repositoryCount: count("repositories"),
          taskCount: count("tasks"),
          memberCount: count("project_members"),
        })
        .from(projects)
        .orderBy(asc(projects.slug)),

    listAllProjectRefs: () => db.select(refColumns).from(projects).orderBy(asc(projects.slug)),

    listProjectRefsForMember: (githubLogin) =>
      db
        .select(refColumns)
        .from(projects)
        .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
        .innerJoin(members, eq(members.id, projectMembers.memberId))
        .where(eq(members.githubLogin, githubLogin))
        .orderBy(asc(projects.slug)),

    async findProjectBySlug(slug, { lock = false } = {}) {
      const query = db.select(projectColumns).from(projects).where(eq(projects.slug, slug)).limit(1);
      const [row] = lock ? await query.for("update") : await query;
      return row;
    },

    async findProjectByDiscordChannelId(channelId) {
      const [row] = await db
        .select(projectColumns)
        .from(projects)
        .where(eq(projects.discordChannelId, channelId))
        .orderBy(asc(projects.slug))
        .limit(1);
      return row;
    },

    createProject: (project) =>
      saveProject(db, (tx) => tx.insert(projects).values(project).returning(projectColumns)),

    updateProject: (projectId, changes) =>
      saveProject(db, (tx) =>
        tx.update(projects).set(changes).where(eq(projects.id, projectId)).returning(projectColumns),
      ),

    async deleteProject(projectId) {
      await db.delete(projects).where(eq(projects.id, projectId));
    },

    async countProjectTasks(projectId) {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(eq(tasks.projectId, projectId));
      return row?.count ?? 0;
    },

    listProjectRepositories: (projectId) =>
      db
        .select({
          fullName: repositories.githubFullName,
          githubInstallationId: repositories.githubInstallationId,
        })
        .from(repositories)
        .where(eq(repositories.projectId, projectId))
        .orderBy(asc(repositories.githubFullName)),

    async addRepository(projectId, fullName) {
      const [row] = await db
        .insert(repositories)
        .values({ projectId, githubFullName: fullName })
        .onConflictDoNothing({ target: repositories.githubFullName })
        .returning({
          fullName: repositories.githubFullName,
          githubInstallationId: repositories.githubInstallationId,
        });
      return row;
    },

    async removeRepository(projectId, fullName) {
      const removed = await db
        .delete(repositories)
        .where(and(eq(repositories.projectId, projectId), eq(repositories.githubFullName, fullName)))
        .returning({ id: repositories.id });
      return removed.length > 0;
    },

    listProjectMembers: (projectId) =>
      db
        .select({ githubLogin: members.githubLogin, createdAt: projectMembers.createdAt })
        .from(projectMembers)
        .innerJoin(members, eq(members.id, projectMembers.memberId))
        .where(eq(projectMembers.projectId, projectId))
        .orderBy(asc(members.githubLogin)),

    async findMemberIdByGithubLogin(githubLogin) {
      const [row] = await db
        .select({ id: members.id })
        .from(members)
        .where(eq(members.githubLogin, githubLogin))
        .limit(1);
      return row?.id;
    },

    async addProjectMember(projectId, memberId) {
      const [row] = await db
        .insert(projectMembers)
        .values({ projectId, memberId })
        .onConflictDoNothing({ target: [projectMembers.projectId, projectMembers.memberId] })
        .returning({ createdAt: projectMembers.createdAt });
      return row;
    },

    async removeProjectMember(projectId, githubLogin) {
      const member = db.select({ id: members.id }).from(members).where(eq(members.githubLogin, githubLogin));
      const removed = await db
        .delete(projectMembers)
        .where(and(eq(projectMembers.projectId, projectId), inArray(projectMembers.memberId, member)))
        .returning({ memberId: projectMembers.memberId });
      return removed.length > 0;
    },

    async unassignOpenProjectTasks(projectId, githubLogin) {
      await db
        .update(tasks)
        .set({ assigneeId: null, status: inProgressBackToTodo })
        .where(
          and(
            eq(tasks.projectId, projectId),
            ne(tasks.status, "done"),
            inArray(tasks.assigneeId, usersMatchingLogin(db, githubLogin)),
          ),
        );
    },
  };
}
