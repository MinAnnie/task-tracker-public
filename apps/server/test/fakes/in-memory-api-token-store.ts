import type {
  ApiTokenRecord,
  ApiTokenStore,
  NewApiToken,
} from "../../src/application/api-token-store.ts";
import type { ProjectRef } from "../../src/application/project-store.ts";

export interface StoredApiToken extends NewApiToken {
  id: number;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/** In-memory implementation of {@link ApiTokenStore}, mirroring the database constraints. */
export class InMemoryApiTokenStore implements ApiTokenStore {
  projects: ProjectRef[] = [];
  /** Users who can create tokens, by id. */
  users: { id: number; githubLogin: string }[] = [];
  tokens: StoredApiToken[] = [];
  /** Every `touchToken` call that changed a row. */
  touches = 0;
  /** Clock used for `api_tokens.created_at` defaults. */
  now: () => Date = () => new Date();

  async findProjectBySlug(slug: string) {
    return this.projects.find((p) => p.slug === slug);
  }

  async listProjectTokens(projectId: number) {
    return this.tokens
      .filter((t) => t.projectId === projectId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)
      .map((t) => this.toRecord(t));
  }

  async createToken(token: NewApiToken) {
    if (this.tokens.some((t) => t.tokenHash === token.tokenHash)) throw new Error("duplicate token_hash");
    const stored: StoredApiToken = {
      ...token,
      id: this.tokens.length + 1,
      createdAt: this.now(),
      lastUsedAt: null,
      revokedAt: null,
    };
    this.tokens.push(stored);
    return this.toRecord(stored);
  }

  async revokeToken(projectId: number, tokenId: number, at: Date) {
    const token = this.tokens.find((t) => t.id === tokenId && t.projectId === projectId);
    if (token === undefined) return false;
    token.revokedAt ??= at;
    return true;
  }

  async findTokenByHash(tokenHash: string) {
    const token = this.tokens.find((t) => t.tokenHash === tokenHash);
    const project = token && this.projects.find((p) => p.id === token.projectId);
    if (token === undefined || project === undefined) return undefined;
    const { id, permission, expiresAt, lastUsedAt, revokedAt } = token;
    return { id, permission, expiresAt, lastUsedAt, revokedAt, project };
  }

  async touchToken(tokenId: number, at: Date, staleBefore: Date) {
    const token = this.tokens.find((t) => t.id === tokenId);
    if (token === undefined) return;
    if (token.lastUsedAt !== null && token.lastUsedAt.getTime() > staleBefore.getTime()) return;
    token.lastUsedAt = at;
    this.touches += 1;
  }

  private toRecord(t: StoredApiToken): ApiTokenRecord {
    return {
      id: t.id,
      projectId: t.projectId,
      name: t.name,
      tokenPrefix: t.tokenPrefix,
      permission: t.permission,
      createdAt: t.createdAt,
      createdByLogin: this.users.find((u) => u.id === t.createdByUserId)?.githubLogin ?? null,
      expiresAt: t.expiresAt,
      lastUsedAt: t.lastUsedAt,
      revokedAt: t.revokedAt,
    };
  }
}
