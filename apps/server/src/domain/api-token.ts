/**
 * What an API token may do. Only `read` exists for now; adding `write` later means
 * extending this list and the `api_token_permission` database enum together.
 */
export const API_TOKEN_PERMISSIONS = ["read"] as const;
export type ApiTokenPermission = (typeof API_TOKEN_PERMISSIONS)[number];

export const API_TOKEN_STATUSES = ["active", "expired", "revoked"] as const;
export type ApiTokenStatus = (typeof API_TOKEN_STATUSES)[number];

/** Every API token starts with this, so secret scanners and humans can recognize it. */
export const API_TOKEN_TYPE_PREFIX = "ttk_";

const NAME_MAX_LENGTH = 60;
const MAX_EXPIRY_DAYS = 365;
/** `ttk_` + 32 random bytes in unpadded base64url (43 characters). */
const TOKEN_FORMAT = /^ttk_[A-Za-z0-9_-]{43}$/;

/** Returns the trimmed name when it has 1–60 characters, `undefined` otherwise. */
export function normalizeApiTokenName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return name.length >= 1 && name.length <= NAME_MAX_LENGTH ? name : undefined;
}

/**
 * Validates a lifetime of 1–365 whole days. `null` (or an absent value) means the
 * token never expires and yields `null`; anything else invalid yields `undefined`.
 */
export function normalizeApiTokenExpiresInDays(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_EXPIRY_DAYS
    ? (value as number)
    : undefined;
}

/** Only `read` is accepted for now; an absent value means `read`. */
export function normalizeApiTokenPermission(value: unknown): ApiTokenPermission | undefined {
  if (value === undefined) return "read";
  return API_TOKEN_PERMISSIONS.find((permission) => permission === value);
}

/** Whether `value` is shaped like an API token, so malformed ones skip the database. */
export function isApiTokenFormat(value: string): boolean {
  return TOKEN_FORMAT.test(value);
}

/** Revocation wins over expiry; a token expires at exactly `expiresAt`. */
export function apiTokenStatus(
  token: { expiresAt: Date | null; revokedAt: Date | null },
  now: Date,
): ApiTokenStatus {
  if (token.revokedAt !== null) return "revoked";
  if (token.expiresAt !== null && token.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}
