import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

/** Opaque session token handed to the browser; only its hash is ever stored. */
export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Hex SHA-256 of a session token, as persisted in `sessions.token_hash`. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
