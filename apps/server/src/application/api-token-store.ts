import type { ApiTokenPermission } from "../domain/api-token.ts";
import type { ProjectRef } from "./project-store.ts";

/** An API token as listed to admins; the secret itself is never stored. */
export interface ApiTokenRecord {
  id: number;
  projectId: number;
  name: string;
  /** First 8 characters after `ttk_`, enough to recognize a token. */
  tokenPrefix: string;
  permission: ApiTokenPermission;
  createdAt: Date;
  /** GitHub login of the admin who created it; `null` once that user is gone. */
  createdByLogin: string | null;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface NewApiToken {
  projectId: number;
  name: string;
  /** Hex SHA-256 of the full token. */
  tokenHash: string;
  tokenPrefix: string;
  permission: ApiTokenPermission;
  createdByUserId: number;
  expiresAt: Date | null;
}

/** What authenticating a request needs to know about the token behind a hash. */
export interface ApiTokenCredential {
  id: number;
  permission: ApiTokenPermission;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  project: ProjectRef;
}

/** Persistence port for project-scoped API tokens. */
export interface ApiTokenStore {
  /** Finds a project by lowercased slug. */
  findProjectBySlug(slug: string): Promise<ProjectRef | undefined>;
  /** Tokens of a project, newest first. */
  listProjectTokens(projectId: number): Promise<ApiTokenRecord[]>;
  createToken(token: NewApiToken): Promise<ApiTokenRecord>;
  /**
   * Revokes a token of the project at `at`, keeping the first revocation time when it
   * was already revoked; resolves whether the project has such a token.
   */
  revokeToken(projectId: number, tokenId: number, at: Date): Promise<boolean>;
  findTokenByHash(tokenHash: string): Promise<ApiTokenCredential | undefined>;
  /** Sets `last_used_at` to `at` unless it is already after `staleBefore`. */
  touchToken(tokenId: number, at: Date, staleBefore: Date): Promise<void>;
}
