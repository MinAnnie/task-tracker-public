import { createHash, randomBytes } from "node:crypto";
import {
  API_TOKEN_TYPE_PREFIX,
  apiTokenStatus,
  isApiTokenFormat,
  normalizeApiTokenExpiresInDays,
  normalizeApiTokenName,
  normalizeApiTokenScope,
  normalizeProjectSlug,
  personalApiTokenScopeAllowed,
  resolveRole,
  type ApiTokenScope,
  type ApiTokenStatus,
} from "../domain/index.ts";
import type { ApiTokenRecord, ApiTokenStore } from "./api-token-store.ts";
import type { SessionUser } from "./auth-store.ts";
import type { ProjectRef } from "./project-store.ts";
import type { AuthenticatedUser } from "./sessions.ts";

/** What resolving the current role of a token's user needs. */
export interface ApiTokenRoleDeps {
  /** Lowercased GitHub logins with the admin role. */
  adminLogins: readonly string[];
  /** Whether a lowercased login is a member. */
  isMember: (githubLogin: string) => Promise<boolean>;
}

export interface ApiTokensDeps extends ApiTokenRoleDeps {
  store: ApiTokenStore;
  now?: () => Date;
  generateToken?: () => string;
}

/** Field of the create request that failed validation; `body` means it is not a JSON object. */
export type ApiTokenField = "body" | "name" | "expiresInDays" | "scope";

/** An API token as shown to its managers: metadata only, never the secret or its hash. */
export interface ApiTokenView {
  id: number;
  name: string;
  /** First 8 characters after `ttk_`. */
  prefix: string;
  scope: ApiTokenScope;
  createdAt: Date;
  createdBy: string | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  status: ApiTokenStatus;
}

interface ApiTokenCallerBase {
  kind: "api_token";
  tokenId: number;
  scope: ApiTokenScope;
}

/**
 * A request authenticated by a valid project token: access to one project, read-only or,
 * with the `write` scope, also a few task writes made as {@link creator}.
 */
export interface ProjectApiTokenCaller extends ApiTokenCallerBase {
  projectId: number;
  project: ProjectRef;
  /** The user who created the token; `null` once that user is gone. */
  creator: SessionUser | null;
}

/**
 * A request authenticated by a valid personal token: it acts as {@link owner}, with the
 * role they hold right now, on every project they can access.
 */
export interface PersonalApiTokenCaller extends ApiTokenCallerBase {
  projectId: null;
  project: null;
  creator: SessionUser;
  owner: AuthenticatedUser;
}

export type ApiTokenCaller = ProjectApiTokenCaller | PersonalApiTokenCaller;

type ProjectNotFound = { status: "project_not_found" };
type Invalid = { status: "invalid"; field: ApiTokenField };
type Created = { status: "created"; token: string; apiToken: ApiTokenView };

export type ListApiTokensResult = { status: "ok"; tokens: ApiTokenView[] } | ProjectNotFound;
export type CreateApiTokenResult = Created | Invalid | ProjectNotFound;
export type RevokeApiTokenResult = { status: "revoked" } | { status: "token_not_found" } | ProjectNotFound;
/** `scope_not_allowed`: a member asked for a `write` personal token. */
export type CreatePersonalApiTokenResult = Created | Invalid | { status: "scope_not_allowed" };
export type RevokePersonalApiTokenResult = { status: "revoked" } | { status: "token_not_found" };

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
  scope: record.scope,
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

/** Parses an untrusted path segment as a token id; `undefined` when it cannot be one. */
function parseTokenId(tokenId: string): number | undefined {
  const id = /^\d{1,10}$/.test(tokenId) ? Number(tokenId) : Number.NaN;
  return id >= 1 && id <= MAX_SERIAL_ID ? id : undefined;
}

/** Validates the fields of an untrusted create request body. */
function parseCreateBody(
  body: unknown,
): { ok: true; name: string; expiresInDays: number | null; scope: ApiTokenScope } | { ok: false; failure: Invalid } {
  const invalid = (field: ApiTokenField) => ({ ok: false as const, failure: { status: "invalid" as const, field } });
  if (!isObject(body)) return invalid("body");
  const name = normalizeApiTokenName(body.name);
  if (name === undefined) return invalid("name");
  const expiresInDays = normalizeApiTokenExpiresInDays(body.expiresInDays);
  if (expiresInDays === undefined) return invalid("expiresInDays");
  const scope = normalizeApiTokenScope(body.scope);
  if (scope === undefined) return invalid("scope");
  return { ok: true, name, expiresInDays, scope };
}

/** Generates a secret and stores the token; the secret is returned here and only here. */
async function issueToken(
  { store, now = () => new Date(), generateToken = generateApiToken }: ApiTokensDeps,
  owner: { projectId: number; ownerUserId: null } | { projectId: null; ownerUserId: number },
  { name, expiresInDays, scope }: { name: string; expiresInDays: number | null; scope: ApiTokenScope },
  actor: AuthenticatedUser,
): Promise<Created> {
  const token = generateToken();
  const at = now();
  const record = await store.createToken({
    ...owner,
    name,
    tokenHash: hashApiToken(token),
    tokenPrefix: token.slice(API_TOKEN_TYPE_PREFIX.length, API_TOKEN_TYPE_PREFIX.length + PREFIX_LENGTH),
    scope,
    createdByUserId: actor.id,
    expiresAt: expiresInDays === null ? null : new Date(at.getTime() + expiresInDays * DAY_MS),
  });
  return { status: "created", token, apiToken: toView(record, at) };
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
 * Creates a token for one project (`read` unless `scope` says `write`) from an untrusted request body. The
 * secret is returned here and only here; the store keeps its hash and display prefix.
 */
export async function createApiToken(
  deps: ApiTokensDeps,
  slug: string,
  body: unknown,
  actor: AuthenticatedUser,
): Promise<CreateApiTokenResult> {
  const parsed = parseCreateBody(body);
  if (!parsed.ok) return parsed.failure;
  const project = await findProject(deps.store, slug);
  if (project === undefined) return { status: "project_not_found" };
  return issueToken(deps, { projectId: project.id, ownerUserId: null }, parsed, actor);
}

/** Revokes a token of the project; revoking it again is a no-op that still succeeds. */
export async function revokeApiToken(
  { store, now = () => new Date() }: ApiTokensDeps,
  slug: string,
  tokenId: string,
): Promise<RevokeApiTokenResult> {
  const project = await findProject(store, slug);
  if (project === undefined) return { status: "project_not_found" };
  const id = parseTokenId(tokenId);
  if (id === undefined) return { status: "token_not_found" };
  return (await store.revokeToken(project.id, id, now())) ? { status: "revoked" } : { status: "token_not_found" };
}

/** The caller's own personal tokens, newest first. */
export async function listPersonalApiTokens(
  { store, now = () => new Date() }: ApiTokensDeps,
  owner: AuthenticatedUser,
): Promise<ApiTokenView[]> {
  const at = now();
  return (await store.listPersonalTokens(owner.id)).map((t) => toView(t, at));
}

/**
 * Creates a personal token for the caller from an untrusted request body. Members may
 * only hold `read` tokens; admins may also ask for `write`.
 */
export async function createPersonalApiToken(
  deps: ApiTokensDeps,
  body: unknown,
  owner: AuthenticatedUser,
): Promise<CreatePersonalApiTokenResult> {
  const parsed = parseCreateBody(body);
  if (!parsed.ok) return parsed.failure;
  if (!personalApiTokenScopeAllowed(owner.role, parsed.scope)) return { status: "scope_not_allowed" };
  return issueToken(deps, { projectId: null, ownerUserId: owner.id }, parsed, owner);
}

/** Revokes one of the caller's personal tokens; anyone else's is reported as not found. */
export async function revokePersonalApiToken(
  { store, now = () => new Date() }: ApiTokensDeps,
  owner: AuthenticatedUser,
  tokenId: string,
): Promise<RevokePersonalApiTokenResult> {
  const id = parseTokenId(tokenId);
  if (id === undefined) return { status: "token_not_found" };
  return (await store.revokePersonalToken(owner.id, id, now()))
    ? { status: "revoked" }
    : { status: "token_not_found" };
}

/**
 * Resolves the caller behind a bearer token, or `undefined` when it is malformed,
 * unknown, revoked or expired, or when it is a personal token whose owner no longer
 * has a role (callers must not tell these apart). Records the use at most once a minute.
 */
export async function authenticateApiToken(deps: ApiTokensDeps, token: string): Promise<ApiTokenCaller | undefined> {
  const { store, now = () => new Date() } = deps;
  if (!isApiTokenFormat(token)) return undefined;
  const credential = await store.findTokenByHash(hashApiToken(token));
  if (credential === undefined) return undefined;
  const at = now();
  if (apiTokenStatus(credential, at) !== "active") return undefined;

  const { id: tokenId, scope, project, creator } = credential;
  let caller: ApiTokenCaller;
  if (project !== null) {
    caller = { kind: "api_token", tokenId, projectId: project.id, project, scope, creator };
  } else {
    const owner = creator === null ? undefined : await withCurrentRole(deps, creator);
    if (creator === null || owner === undefined) return undefined;
    caller = { kind: "api_token", tokenId, projectId: null, project: null, scope, creator, owner };
  }

  const staleBefore = new Date(at.getTime() - LAST_USED_THROTTLE_MS);
  if (credential.lastUsedAt === null || credential.lastUsedAt.getTime() <= staleBefore.getTime()) {
    await store.touchToken(credential.id, at, staleBefore);
  }
  return caller;
}

/** The user with the role they hold right now, or `undefined` when they have none. */
async function withCurrentRole(
  { adminLogins, isMember }: ApiTokenRoleDeps,
  user: SessionUser,
): Promise<AuthenticatedUser | undefined> {
  const role = resolveRole(user.githubLogin, adminLogins, await isMember(user.githubLogin.toLowerCase()));
  return role === null ? undefined : { ...user, role };
}

/**
 * The user a write token acts as: its creator, with the role they hold right now
 * (re-checked on every request, like a session). `undefined` once the creator is gone
 * or no longer an admin or member.
 */
export async function resolveApiTokenActor(
  deps: ApiTokenRoleDeps,
  caller: ApiTokenCaller,
): Promise<AuthenticatedUser | undefined> {
  return caller.creator === null ? undefined : withCurrentRole(deps, caller.creator);
}
