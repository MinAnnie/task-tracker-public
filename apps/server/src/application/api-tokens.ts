import { createHash, randomBytes } from "node:crypto";
import {
  API_TOKEN_TYPE_PREFIX,
  apiTokenStatus,
  isApiTokenFormat,
  normalizeApiTokenExpiresInDays,
  normalizeApiTokenName,
  normalizeApiTokenPermission,
  normalizeProjectSlug,
  type ApiTokenPermission,
  type ApiTokenStatus,
} from "../domain/index.ts";
import type { ApiTokenRecord, ApiTokenStore } from "./api-token-store.ts";
import type { ProjectRef } from "./project-store.ts";
import type { AuthenticatedUser } from "./sessions.ts";
import type { ApiTokenViewer } from "./tasks.ts";

export interface ApiTokensDeps {
  store: ApiTokenStore;
  now?: () => Date;
  generateToken?: () => string;
}

/** Field of the create request that failed validation; `body` means it is not a JSON object. */
export type ApiTokenField = "body" | "name" | "expiresInDays" | "permission";

/** An API token as shown to admins: metadata only, never the secret or its hash. */
export interface ApiTokenView {
  id: number;
  name: string;
  /** First 8 characters after `ttk_`. */
  prefix: string;
  permission: ApiTokenPermission;
  createdAt: Date;
  createdBy: string | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  status: ApiTokenStatus;
}

/** A request authenticated by a valid API token: read-only access to one project. */
export interface ApiTokenCaller extends ApiTokenViewer {
  tokenId: number;
  project: ProjectRef;
}

type ProjectNotFound = { status: "project_not_found" };

export type ListApiTokensResult = { status: "ok"; tokens: ApiTokenView[] } | ProjectNotFound;
export type CreateApiTokenResult =
  | { status: "created"; token: string; apiToken: ApiTokenView }
  | { status: "invalid"; field: ApiTokenField }
  | ProjectNotFound;
export type RevokeApiTokenResult = { status: "revoked" } | { status: "token_not_found" } | ProjectNotFound;

const TOKEN_BYTES = 32;
const PREFIX_LENGTH = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
/** `last_used_at` is refreshed at most this often per token, sparing a write per request. */
const LAST_USED_THROTTLE_MS = 60 * 1000;
const MAX_SERIAL_ID = 2_147_483_647;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A new secret: `ttk_` + 32 random bytes in base64url. Only its hash is ever stored. */
export function generateApiToken(): string {
  return API_TOKEN_TYPE_PREFIX + randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Hex SHA-256 of an API token, as persisted in `api_tokens.token_hash`. */
export function hashApiToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const toView = (record: ApiTokenRecord, now: Date): ApiTokenView => ({
  id: record.id,
  name: record.name,
  prefix: record.tokenPrefix,
  permission: record.permission,
  createdAt: record.createdAt,
  createdBy: record.createdByLogin,
  lastUsedAt: record.lastUsedAt,
  expiresAt: record.expiresAt,
  revokedAt: record.revokedAt,
  status: apiTokenStatus(record, now),
});

async function findProject(store: ApiTokenStore, slug: string): Promise<ProjectRef | undefined> {
  const normalized = normalizeProjectSlug(slug);
  return normalized === undefined ? undefined : store.findProjectBySlug(normalized);
}

/** The project's tokens, newest first. */
export async function listApiTokens(
  { store, now = () => new Date() }: ApiTokensDeps,
  slug: string,
): Promise<ListApiTokensResult> {
  const project = await findProject(store, slug);
  if (project === undefined) return { status: "project_not_found" };
  const at = now();
  return { status: "ok", tokens: (await store.listProjectTokens(project.id)).map((t) => toView(t, at)) };
}

/**
 * Creates a read-only token for one project from an untrusted request body. The
 * secret is returned here and only here; the store keeps its hash and display prefix.
 */
export async function createApiToken(
  { store, now = () => new Date(), generateToken = generateApiToken }: ApiTokensDeps,
  slug: string,
  body: unknown,
  actor: AuthenticatedUser,
): Promise<CreateApiTokenResult> {
  if (!isObject(body)) return { status: "invalid", field: "body" };
  const name = normalizeApiTokenName(body.name);
  if (name === undefined) return { status: "invalid", field: "name" };
  const expiresInDays = normalizeApiTokenExpiresInDays(body.expiresInDays);
  if (expiresInDays === undefined) return { status: "invalid", field: "expiresInDays" };
  const permission = normalizeApiTokenPermission(body.permission);
  if (permission === undefined) return { status: "invalid", field: "permission" };

  const project = await findProject(store, slug);
  if (project === undefined) return { status: "project_not_found" };

  const token = generateToken();
  const at = now();
  const record = await store.createToken({
    projectId: project.id,
    name,
    tokenHash: hashApiToken(token),
    tokenPrefix: token.slice(API_TOKEN_TYPE_PREFIX.length, API_TOKEN_TYPE_PREFIX.length + PREFIX_LENGTH),
    permission,
    createdByUserId: actor.id,
    expiresAt: expiresInDays === null ? null : new Date(at.getTime() + expiresInDays * DAY_MS),
  });
  return { status: "created", token, apiToken: toView(record, at) };
}

/** Revokes a token of the project; revoking it again is a no-op that still succeeds. */
export async function revokeApiToken(
  { store, now = () => new Date() }: ApiTokensDeps,
  slug: string,
  tokenId: string,
): Promise<RevokeApiTokenResult> {
  const project = await findProject(store, slug);
  if (project === undefined) return { status: "project_not_found" };
  const id = /^\d{1,10}$/.test(tokenId) ? Number(tokenId) : Number.NaN;
  if (!(id >= 1 && id <= MAX_SERIAL_ID)) return { status: "token_not_found" };
  return (await store.revokeToken(project.id, id, now())) ? { status: "revoked" } : { status: "token_not_found" };
}

/**
 * Resolves the caller behind a bearer token, or `undefined` when it is malformed,
 * unknown, revoked or expired (callers must not tell these apart). Records the use
 * at most once a minute.
 */
export async function authenticateApiToken(
  { store, now = () => new Date() }: ApiTokensDeps,
  token: string,
): Promise<ApiTokenCaller | undefined> {
  if (!isApiTokenFormat(token)) return undefined;
  const credential = await store.findTokenByHash(hashApiToken(token));
  if (credential === undefined) return undefined;
  const at = now();
  if (apiTokenStatus(credential, at) !== "active" || credential.permission !== "read") return undefined;

  const staleBefore = new Date(at.getTime() - LAST_USED_THROTTLE_MS);
  if (credential.lastUsedAt === null || credential.lastUsedAt.getTime() <= staleBefore.getTime()) {
    await store.touchToken(credential.id, at, staleBefore);
  }
  return { kind: "api_token", tokenId: credential.id, projectId: credential.project.id, project: credential.project };
}
