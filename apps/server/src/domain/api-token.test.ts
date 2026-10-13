import { describe, expect, it } from "vitest";
import {
  apiTokenStatus,
  isApiTokenFormat,
  normalizeApiTokenExpiresInDays,
  normalizeApiTokenName,
  normalizeApiTokenPermission,
} from "./api-token.ts";

describe("normalizeApiTokenName", () => {
  it.each([
    ["CI agent", "CI agent"],
    ["  VPS bot  ", "VPS bot"],
    ["x".repeat(60), "x".repeat(60)],
  ])("accepts %j as %j", (input, expected) => {
    expect(normalizeApiTokenName(input)).toBe(expected);
  });

  it.each([[""], ["   "], ["x".repeat(61)], [null], [undefined], [42], [{}]])("rejects %j", (input) => {
    expect(normalizeApiTokenName(input)).toBeUndefined();
  });
});

describe("normalizeApiTokenExpiresInDays", () => {
  it.each([
    [1, 1],
    [90, 90],
    [365, 365],
    [null, null],
    [undefined, null],
  ])("accepts %j as %j", (input, expected) => {
    expect(normalizeApiTokenExpiresInDays(input)).toBe(expected);
  });

  it.each([[0], [366], [1.5], [-1], ["90"], [Number.NaN], [{}]])("rejects %j", (input) => {
    expect(normalizeApiTokenExpiresInDays(input)).toBeUndefined();
  });
});

describe("normalizeApiTokenPermission", () => {
  it("accepts read, the default", () => {
    expect(normalizeApiTokenPermission(undefined)).toBe("read");
    expect(normalizeApiTokenPermission("read")).toBe("read");
  });

  it.each([["write"], ["admin"], [null], [1]])("rejects %j", (input) => {
    expect(normalizeApiTokenPermission(input)).toBeUndefined();
  });
});

describe("isApiTokenFormat", () => {
  const valid = `ttk_${"A".repeat(42)}w`;

  it("accepts ttk_ followed by 43 base64url characters", () => {
    expect(isApiTokenFormat(valid)).toBe(true);
    expect(isApiTokenFormat(`ttk_${"-_aZ09".repeat(7)}x`)).toBe(true);
  });

  it.each([
    [""],
    ["ttk_"],
    [`TTK_${"A".repeat(43)}`],
    [`ttk_${"A".repeat(42)}`],
    [`ttk_${"A".repeat(44)}`],
    [`ttk_${"A".repeat(42)}=`],
    [`xyz_${"A".repeat(43)}`],
  ])("rejects %j", (input) => {
    expect(isApiTokenFormat(input)).toBe(false);
  });
});

describe("apiTokenStatus", () => {
  const now = new Date("2026-05-01T12:00:00Z");

  it("is active without expiry or revocation", () => {
    expect(apiTokenStatus({ expiresAt: null, revokedAt: null }, now)).toBe("active");
    expect(apiTokenStatus({ expiresAt: new Date("2026-05-01T12:00:01Z"), revokedAt: null }, now)).toBe("active");
  });

  it("is expired once the expiry is reached", () => {
    expect(apiTokenStatus({ expiresAt: now, revokedAt: null }, now)).toBe("expired");
  });

  it("is revoked when revoked, even if also expired", () => {
    expect(apiTokenStatus({ expiresAt: new Date("2026-01-01T00:00:00Z"), revokedAt: now }, now)).toBe("revoked");
  });
});
