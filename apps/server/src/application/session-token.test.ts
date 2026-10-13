import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateSessionToken, hashSessionToken } from "./session-token.ts";

describe("generateSessionToken", () => {
  it("returns a URL-safe token encoding 32 random bytes", () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("returns a different token on every call", () => {
    const tokens = new Set(Array.from({ length: 50 }, generateSessionToken));
    expect(tokens.size).toBe(50);
  });
});

describe("hashSessionToken", () => {
  it("returns the hex SHA-256 digest of the token", () => {
    expect(hashSessionToken("abc")).toBe(createHash("sha256").update("abc").digest("hex"));
  });

  it("never returns the token itself", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).not.toContain(token);
  });
});
