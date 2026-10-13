import { describe, expect, it } from "vitest";
import {
  normalizeDiscordChannelId,
  normalizeProjectName,
  normalizeProjectSlug,
  normalizeRepositoryFullName,
  normalizeTaskKeyPrefix,
} from "./project-fields.ts";

const NON_STRINGS = [undefined, null, 42, {}, ["x"], true];

describe("normalizeProjectSlug", () => {
  it.each([
    ["shop", "shop"],
    ["Shop", "shop"],
    ["a", "a"],
    ["web-shop-2", "web-shop-2"],
    ["2fa", "2fa"],
    ["a".repeat(50), "a".repeat(50)],
  ])("accepts %j as %j", (input, expected) => {
    expect(normalizeProjectSlug(input)).toBe(expected);
  });

  it.each([[""], ["a".repeat(51)], ["-shop"], ["shop-"], ["web--shop"], ["web_shop"], ["web shop"], [" shop"], ["shóp"], ["\u212Aiwi"]])(
    "rejects %j",
    (input) => {
      expect(normalizeProjectSlug(input)).toBeUndefined();
    },
  );

  it("rejects non-string values", () => {
    for (const value of NON_STRINGS) expect(normalizeProjectSlug(value)).toBeUndefined();
  });
});

describe("normalizeProjectName", () => {
  it.each([
    ["Shop", "Shop"],
    ["  Web Shop  ", "Web Shop"],
    ["x".repeat(100), "x".repeat(100)],
    [` ${"x".repeat(100)} `, "x".repeat(100)],
  ])("accepts %j as %j", (input, expected) => {
    expect(normalizeProjectName(input)).toBe(expected);
  });

  it.each([[""], ["   "], ["x".repeat(101)]])("rejects %j", (input) => {
    expect(normalizeProjectName(input)).toBeUndefined();
  });

  it("rejects non-string values", () => {
    for (const value of NON_STRINGS) expect(normalizeProjectName(value)).toBeUndefined();
  });
});

describe("normalizeTaskKeyPrefix", () => {
  it.each([
    ["RF", "RF"],
    ["rf", "RF"],
    ["R", "R"],
    ["A1B2", "A1B2"],
    ["ABCDEFGHIJ", "ABCDEFGHIJ"],
  ])("accepts %j as %j", (input, expected) => {
    expect(normalizeTaskKeyPrefix(input)).toBe(expected);
  });

  it.each([[""], ["ABCDEFGHIJK"], ["1RF"], ["R-F"], ["R_F"], [" RF"], ["RF "], ["RÉ"], ["ß"], ["ﬀ"]])(
    "rejects %j",
    (input) => {
      expect(normalizeTaskKeyPrefix(input)).toBeUndefined();
    },
  );

  it("rejects non-string values", () => {
    for (const value of NON_STRINGS) expect(normalizeTaskKeyPrefix(value)).toBeUndefined();
  });
});

describe("normalizeDiscordChannelId", () => {
  it.each([["1".repeat(17)], ["1".repeat(20)], ["123456789012345678"]])("accepts %j", (input) => {
    expect(normalizeDiscordChannelId(input)).toBe(input);
  });

  it("maps null to null (no channel)", () => {
    expect(normalizeDiscordChannelId(null)).toBeNull();
  });

  it.each([[""], ["1".repeat(16)], ["1".repeat(21)], ["12345678901234567a"], [" 123456789012345678"], [undefined], [123456789012345678], [{}]])(
    "rejects %j",
    (input) => {
      expect(normalizeDiscordChannelId(input)).toBeUndefined();
    },
  );
});

describe("normalizeRepositoryFullName", () => {
  it.each([
    ["acme/shop", "acme/shop"],
    ["Acme/Shop", "acme/shop"],
    ["mona-lisa/my_repo.js", "mona-lisa/my_repo.js"],
    ["a/b", "a/b"],
    ["acme/.github", "acme/.github"],
    ["acme/...", "acme/..."],
    [`${"a".repeat(39)}/${"r".repeat(100)}`, `${"a".repeat(39)}/${"r".repeat(100)}`],
  ])("accepts %j as %j", (input, expected) => {
    expect(normalizeRepositoryFullName(input)).toBe(expected);
  });

  it.each([
    [""],
    ["acme"],
    ["acme/"],
    ["/shop"],
    ["acme/shop/extra"],
    ["-acme/shop"],
    ["ac--me/shop"],
    [`${"a".repeat(40)}/shop`],
    [`acme/${"r".repeat(101)}`],
    ["acme/."],
    ["acme/.."],
    ["acme/sh op"],
    ["acme/shöp"],
    ["acme/\u212Ait"],
    [" acme/shop"],
  ])("rejects %j", (input) => {
    expect(normalizeRepositoryFullName(input)).toBeUndefined();
  });

  it("rejects non-string values", () => {
    for (const value of NON_STRINGS) expect(normalizeRepositoryFullName(value)).toBeUndefined();
  });
});
