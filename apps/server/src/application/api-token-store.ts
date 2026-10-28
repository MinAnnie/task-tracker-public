import type { ApiTokenScope } from "../domain/api-token.ts";
import type { SessionUser } from "./auth-store.ts";
import type { ProjectRef } from "./project-store.ts";

/** An API token as listed to its managers; the secret itself is never stored. */
export interface ApiTokenRecord {
  id: number;
  /** The project of a project token; `null` for a personal token. */
  projectId: number | null;
  name: string;
  /** First 8 characters after `ttk_`, enough to recognize a token. */
  tokenPrefix: string;
  scope: ApiTokenScope;
  createdAt: Date;
  /** GitHub login of the user who created it; `null` once that user is gone. */
  createdByLogin: string | null;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * A project token (`projectId` set, `ownerUserId` null) or a personal token
 * (`ownerUserId` set, `projectId` null); never both, never neither.
 */
export interface NewApiToken {
  projectId: number | null;
  ownerUserId: number | null;
  name: string;
  /** Hex SHA-256 of the full token. */
  tokenHash: string;
  tokenPrefix: string;
  scope: ApiTokenScope;
  createdByUserId: number;
  expiresAt: Date | null;
}

/** What authenticating a request needs to know about the token behind a hash. */
export interface ApiTokenCredential {
  id: number;
  scope: ApiTokenScope;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  /** The project of a project token; `null` for a personal token. */
  project: ProjectRef | null;
  /**
   * The user who created it, whose access a write token acts with; `null` once that user
   * is gone. For a personal token this is its owner.
   */
  creator: SessionUser | null;
}

/** Persistence port for API tokens, project and personal. */
export interface ApiTokenStore {
  /** Finds a project by lowercased slug. */
  findProjectBySlug(slug: string): Promise<ProjectRef | undefined>;
  /** Tokens of a project, newest first (never personal tokens). */
  listProjectTokens(projectId: number): Promise<ApiTokenRecord[]>;
  /** Personal tokens of a user, newest first. */
  listPersonalTokens(ownerUserId: number): Promise<ApiTokenRecord[]>;
  createToken(token: NewApiToken): Promise<ApiTokenRecord>;
  /**
   * Revokes a token of the project at `at`, keeping the first revocation time when it
   * was already revoked; resolves whether the project has such a token.
   */
  revokeToken(projectId: number, tokenId: number, at: Date): Promise<boolean>;
  /** Like {@link revokeToken}, for a personal token of `ownerUserId`. */
  revokePersonalToken(ownerUserId: number, tokenId: number, at: Date): Promise<boolean>;
  findTokenByHash(tokenHash: string): Promise<ApiTokenCredential | undefined>;
  /** Sets `last_used_at` to `at` unless it is already after `staleBefore`. */
  touchToken(tokenId: number, at: Date, staleBefore: Date): Promise<void>;
}
