/** A GitHub account as returned by `GET /user`, reduced to what the app keeps. */
export interface GithubUserProfile {
  githubId: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

/** A Discord account linked to a user: its snowflake id and the name shown for it. */
export interface DiscordAccount {
  id: string;
  username: string;
}

/** The signed-in user, as exposed to the web app. */
export interface SessionUser {
  id: number;
  githubLogin: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface NewSession {
  userId: number;
  /** Hex SHA-256 of the opaque session token; the token itself is never stored. */
  tokenHash: string;
  expiresAt: Date;
}

export interface SessionRecord {
  expiresAt: Date;
  user: SessionUser;
}

/** A GitHub login granted the member role by an admin. */
export interface MemberRecord {
  /** Lowercased GitHub login. */
  githubLogin: string;
  createdAt: Date;
  /** Login of the user who added the member, when that user still exists. */
  addedBy: string | null;
}

export interface NewMember {
  /** Lowercased GitHub login. */
  githubLogin: string;
  addedByUserId: number | null;
}

/** Persistence port for users, sessions and members. Implemented by infrastructure adapters. */
export interface AuthStore {
  /** Runs `work` atomically; the callback receives a store bound to the transaction. */
  transaction<T>(work: (store: AuthStore) => Promise<T>): Promise<T>;
  /** Inserts the user or refreshes login, name and avatar of the one with the same GitHub id. */
  upsertUserByGithubId(profile: GithubUserProfile): Promise<{ id: number }>;
  createSession(session: NewSession): Promise<void>;
  /** Returns the session regardless of expiry; callers decide what expired means. */
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | undefined>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;
  deleteSessionsByUserId(userId: number): Promise<void>;
  /** Deletes the sessions of every user whose login matches `githubLogin` case-insensitively. */
  deleteSessionsByGithubLogin(githubLogin: string): Promise<void>;
  /** Whether a lowercased login is a member. */
  isMember(githubLogin: string): Promise<boolean>;
  /** All members, ordered by login. */
  listMembers(): Promise<MemberRecord[]>;
  /** Inserts the member; resolves `undefined` without changes when the login already is one. */
  addMember(member: NewMember): Promise<{ createdAt: Date } | undefined>;
  /** Deletes a member by lowercased login; resolves whether one existed. */
  removeMember(githubLogin: string): Promise<boolean>;
  /**
   * Clears the assignee of tasks in every project that are not `done` and are
   * assigned to a user whose login matches `githubLogin` case-insensitively.
   * Unassigned `in_progress` tasks go back to `todo`; other statuses stay.
   */
  unassignOpenTasksByGithubLogin(githubLogin: string): Promise<void>;
  /** The Discord account linked to a user, or `null` when none is (or the user is unknown). */
  findDiscordAccount(userId: number): Promise<DiscordAccount | null>;
  /** Id of the user a Discord account is linked to, or `undefined` when it is not linked. */
  findUserIdByDiscordId(discordUserId: string): Promise<number | undefined>;
  /** The user a Discord account is linked to, or `undefined` when it is not linked. */
  findUserByDiscordId(discordUserId: string): Promise<SessionUser | undefined>;
  /** Links (replacing any previous link) or, with `null`, unlinks the user's Discord account. */
  setDiscordAccount(userId: number, account: DiscordAccount | null): Promise<void>;
}
