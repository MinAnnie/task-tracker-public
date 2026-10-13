import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type { AuthStore } from "../application/auth-store.ts";
import * as schema from "../db/schema.ts";
import type { TaskStatus } from "../domain/task-status.ts";

const { members, sessions, tasks, users } = schema;

/** A database handle or an open transaction; both expose the same query API. */
export type Executor = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

/** Postgres adapter for {@link AuthStore} built on Drizzle. */
export function createDrizzleAuthStore(db: Executor): AuthStore {
  return {
    transaction: (work) => db.transaction((tx) => work(createDrizzleAuthStore(tx))),

    async upsertUserByGithubId({ githubId, login, name, avatarUrl }) {
      const mutable = { githubLogin: login, name, avatarUrl };
      const [row] = await db
        .insert(users)
        .values({ githubId, ...mutable })
        .onConflictDoUpdate({ target: users.githubId, set: mutable })
        .returning({ id: users.id });
      if (row === undefined) throw new Error("User upsert returned no row");
      return row;
    },

    async createSession(session) {
      await db.insert(sessions).values(session);
    },

    async findSessionByTokenHash(tokenHash) {
      const [row] = await db
        .select({
          expiresAt: sessions.expiresAt,
          user: {
            id: users.id,
            githubLogin: users.githubLogin,
            name: users.name,
            avatarUrl: users.avatarUrl,
          },
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.tokenHash, tokenHash))
        .limit(1);
      return row;
    },

    async deleteSessionByTokenHash(tokenHash) {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },

    async deleteSessionsByUserId(userId) {
      await db.delete(sessions).where(eq(sessions.userId, userId));
    },

    async deleteSessionsByGithubLogin(githubLogin) {
      await db.delete(sessions).where(inArray(sessions.userId, usersMatchingLogin(db, githubLogin)));
    },

    async isMember(githubLogin) {
      const [row] = await db
        .select({ id: members.id })
        .from(members)
        .where(eq(members.githubLogin, githubLogin))
        .limit(1);
      return row !== undefined;
    },

    async listMembers() {
      return db
        .select({
          githubLogin: members.githubLogin,
          createdAt: members.createdAt,
          addedBy: users.githubLogin,
        })
        .from(members)
        .leftJoin(users, eq(users.id, members.addedByUserId))
        .orderBy(asc(members.githubLogin));
    },

    async addMember(member) {
      const [row] = await db
        .insert(members)
        .values(member)
        .onConflictDoNothing({ target: members.githubLogin })
        .returning({ createdAt: members.createdAt });
      return row;
    },

    async removeMember(githubLogin) {
      const removed = await db
        .delete(members)
        .where(eq(members.githubLogin, githubLogin))
        .returning({ id: members.id });
      return removed.length > 0;
    },

    async unassignOpenTasksByGithubLogin(githubLogin) {
      await db
        .update(tasks)
        .set({ assigneeId: null, status: inProgressBackToTodo })
        .where(
          and(
            ne(tasks.status, "done"),
            inArray(tasks.assigneeId, usersMatchingLogin(db, githubLogin)),
          ),
        );
    },

    async findDiscordAccount(userId) {
      const [row] = await db
        .select({ id: users.discordUserId, username: users.discordUsername })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (row?.id == null) return null;
      return { id: row.id, username: row.username ?? "" };
    },

    async findUserIdByDiscordId(discordUserId) {
      const [row] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.discordUserId, discordUserId))
        .limit(1);
      return row?.id;
    },

    async findUserByDiscordId(discordUserId) {
      const [row] = await db
        .select({ id: users.id, githubLogin: users.githubLogin, name: users.name, avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.discordUserId, discordUserId))
        .limit(1);
      return row;
    },

    async setDiscordAccount(userId, account) {
      await db
        .update(users)
        .set({ discordUserId: account?.id ?? null, discordUsername: account?.username ?? null })
        .where(eq(users.id, userId));
    },
  };
}

/** Status update for unassigned tasks: `in_progress` goes back to `todo`, others stay. */
export const inProgressBackToTodo = sql<TaskStatus>`case when ${tasks.status} = 'in_progress' then 'todo' else ${tasks.status} end`;

/** Ids of users whose login matches `githubLogin` case-insensitively. */
export function usersMatchingLogin(db: Executor, githubLogin: string) {
  return db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.githubLogin})`, githubLogin.toLowerCase()));
}
