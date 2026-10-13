import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { ApiTokenRecord, ApiTokenStore } from "../application/api-token-store.ts";
import * as schema from "../db/schema.ts";
import type { Executor } from "./drizzle-auth-store.ts";

const { apiTokens, projects, users } = schema;

const projectRefColumns = {
  id: projects.id,
  slug: projects.slug,
  name: projects.name,
  taskKeyPrefix: projects.taskKeyPrefix,
};

const recordColumns = {
  id: apiTokens.id,
  projectId: apiTokens.projectId,
  name: apiTokens.name,
  tokenPrefix: apiTokens.tokenPrefix,
  permission: apiTokens.permission,
  createdAt: apiTokens.createdAt,
  createdByLogin: users.githubLogin,
  expiresAt: apiTokens.expiresAt,
  lastUsedAt: apiTokens.lastUsedAt,
  revokedAt: apiTokens.revokedAt,
};

/** Postgres adapter for {@link ApiTokenStore} built on Drizzle. */
export function createDrizzleApiTokenStore(db: Executor): ApiTokenStore {
  const findRecord = async (id: number): Promise<ApiTokenRecord> => {
    const [row] = await db
      .select(recordColumns)
      .from(apiTokens)
      .leftJoin(users, eq(users.id, apiTokens.createdByUserId))
      .where(eq(apiTokens.id, id));
    if (row === undefined) throw new Error(`API token ${id} vanished after a write`);
    return row;
  };

  return {
    async findProjectBySlug(slug) {
      const [row] = await db.select(projectRefColumns).from(projects).where(eq(projects.slug, slug)).limit(1);
      return row;
    },

    listProjectTokens: (projectId) =>
      db
        .select(recordColumns)
        .from(apiTokens)
        .leftJoin(users, eq(users.id, apiTokens.createdByUserId))
        .where(eq(apiTokens.projectId, projectId))
        .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id)),

    async createToken(token) {
      const [row] = await db.insert(apiTokens).values(token).returning({ id: apiTokens.id });
      if (row === undefined) throw new Error("API token insert returned no row");
      return findRecord(row.id);
    },

    async revokeToken(projectId, tokenId, at) {
      const rows = await db
        .update(apiTokens)
        .set({ revokedAt: sql`coalesce(${apiTokens.revokedAt}, ${at.toISOString()}::timestamptz)` })
        .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.projectId, projectId)))
        .returning({ id: apiTokens.id });
      return rows.length > 0;
    },

    async findTokenByHash(tokenHash) {
      const [row] = await db
        .select({
          id: apiTokens.id,
          permission: apiTokens.permission,
          expiresAt: apiTokens.expiresAt,
          lastUsedAt: apiTokens.lastUsedAt,
          revokedAt: apiTokens.revokedAt,
          project: projectRefColumns,
        })
        .from(apiTokens)
        .innerJoin(projects, eq(projects.id, apiTokens.projectId))
        .where(eq(apiTokens.tokenHash, tokenHash))
        .limit(1);
      return row;
    },

    async touchToken(tokenId, at, staleBefore) {
      await db
        .update(apiTokens)
        .set({ lastUsedAt: at })
        .where(
          and(
            eq(apiTokens.id, tokenId),
            or(isNull(apiTokens.lastUsedAt), lte(apiTokens.lastUsedAt, staleBefore)),
          ),
        );
    },
  };
}
