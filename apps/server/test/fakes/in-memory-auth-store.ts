import type {
  AuthStore,
  DiscordAccount,
  GithubUserProfile,
  MemberRecord,
  NewMember,
  NewSession,
  SessionRecord,
} from "../../src/application/auth-store.ts";
import type { StoredTask } from "./in-memory-project-store.ts";

interface StoredUser extends GithubUserProfile {
  id: number;
  discordUserId?: string | null;
  discordUsername?: string | null;
}

interface StoredSession extends NewSession {
  id: number;
}

interface StoredMember extends NewMember {
  id: number;
  createdAt: Date;
}

/** In-memory implementation of {@link AuthStore}, mirroring the database constraints. */
export class InMemoryAuthStore implements AuthStore {
  users: StoredUser[] = [];
  sessions: StoredSession[] = [];
  members: StoredMember[] = [];
  /** Tasks seeded by tests; only their assignee is managed here. */
  tasks: StoredTask[] = [];
  transactions = 0;
  /** Clock used for `members.created_at` defaults. */
  now: () => Date = () => new Date();

  async transaction<T>(work: (store: AuthStore) => Promise<T>): Promise<T> {
    this.transactions += 1;
    return work(this);
  }

  async upsertUserByGithubId(profile: GithubUserProfile) {
    const existing = this.users.find((u) => u.githubId === profile.githubId);
    if (existing) {
      Object.assign(existing, profile);
      return { id: existing.id };
    }
    const id = this.users.length + 1;
    this.users.push({ ...profile, id });
    return { id };
  }

  async createSession(session: NewSession) {
    if (!this.users.some((u) => u.id === session.userId)) throw new Error("unknown user");
    if (this.sessions.some((s) => s.tokenHash === session.tokenHash)) {
      throw new Error("duplicate token hash");
    }
    this.sessions.push({ ...session, id: this.sessions.length + 1 });
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | undefined> {
    const session = this.sessions.find((s) => s.tokenHash === tokenHash);
    const user = this.users.find((u) => u.id === session?.userId);
    if (session === undefined || user === undefined) return undefined;
    return {
      expiresAt: session.expiresAt,
      user: { id: user.id, githubLogin: user.login, name: user.name, avatarUrl: user.avatarUrl },
    };
  }

  async deleteSessionByTokenHash(tokenHash: string) {
    this.sessions = this.sessions.filter((s) => s.tokenHash !== tokenHash);
  }

  async deleteSessionsByUserId(userId: number) {
    this.sessions = this.sessions.filter((s) => s.userId !== userId);
  }

  async deleteSessionsByGithubLogin(githubLogin: string) {
    const userIds = new Set(
      this.users.filter((u) => u.login.toLowerCase() === githubLogin.toLowerCase()).map((u) => u.id),
    );
    this.sessions = this.sessions.filter((s) => !userIds.has(s.userId));
  }

  async isMember(githubLogin: string) {
    return this.members.some((m) => m.githubLogin === githubLogin);
  }

  async listMembers(): Promise<MemberRecord[]> {
    return [...this.members]
      .sort((a, b) => a.githubLogin.localeCompare(b.githubLogin))
      .map((m) => ({
        githubLogin: m.githubLogin,
        createdAt: m.createdAt,
        addedBy: this.users.find((u) => u.id === m.addedByUserId)?.login ?? null,
      }));
  }

  async addMember(member: NewMember) {
    if (member.githubLogin !== member.githubLogin.toLowerCase()) {
      throw new Error("member login must be lowercase");
    }
    if (member.addedByUserId !== null && !this.users.some((u) => u.id === member.addedByUserId)) {
      throw new Error("unknown user");
    }
    if (this.members.some((m) => m.githubLogin === member.githubLogin)) return undefined;
    const createdAt = this.now();
    this.members.push({ ...member, id: this.members.length + 1, createdAt });
    return { createdAt };
  }

  async removeMember(githubLogin: string) {
    const before = this.members.length;
    this.members = this.members.filter((m) => m.githubLogin !== githubLogin);
    return this.members.length < before;
  }

  async unassignOpenTasksByGithubLogin(githubLogin: string) {
    const userIds = new Set(
      this.users.filter((u) => u.login.toLowerCase() === githubLogin.toLowerCase()).map((u) => u.id),
    );
    for (const task of this.tasks) {
      if (task.status !== "done" && task.assigneeId !== null && userIds.has(task.assigneeId)) {
        task.assigneeId = null;
        if (task.status === "in_progress") task.status = "todo";
      }
    }
  }

  async findDiscordAccount(userId: number): Promise<DiscordAccount | null> {
    const user = this.users.find((u) => u.id === userId);
    if (!user?.discordUserId) return null;
    return { id: user.discordUserId, username: user.discordUsername ?? "" };
  }

  async findUserIdByDiscordId(discordUserId: string) {
    return this.users.find((u) => u.discordUserId === discordUserId)?.id;
  }

  async findUserByDiscordId(discordUserId: string) {
    const user = this.users.find((u) => u.discordUserId === discordUserId);
    return user && { id: user.id, githubLogin: user.login, name: user.name, avatarUrl: user.avatarUrl };
  }

  async setDiscordAccount(userId: number, account: DiscordAccount | null) {
    const user = this.users.find((u) => u.id === userId);
    if (user === undefined) return;
    // Mirrors the unique constraint on users.discord_user_id.
    if (account !== null && this.users.some((u) => u.id !== userId && u.discordUserId === account.id)) {
      throw new Error("duplicate discord user id");
    }
    user.discordUserId = account?.id ?? null;
    user.discordUsername = account?.username ?? null;
  }
}
