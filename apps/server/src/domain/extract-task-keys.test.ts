import { describe, expect, it } from "vitest";
import { extractTaskKeys } from "./extract-task-keys.ts";

const known = ["RF-04", "RF-040", "E0-01", "E0-1", "AB-7"];

describe("extractTaskKeys", () => {
  it.each([
    ["feat/RF-04-wompi", ["RF-04"]],
    ["rf-04", ["RF-04"]],
    ["RF-04: add payment", ["RF-04"]],
    ["[RF-04] add payment", ["RF-04"]],
    ["(RF-04) add payment", ["RF-04"]],
    ["fix/rf-04_wompi", ["RF-04"]],
    ["feature/RF-04.wompi", ["RF-04"]],
    ["Implements RF-04", ["RF-04"]],
  ])("finds the key in %j", (text, expected) => {
    expect(extractTaskKeys(text, known)).toEqual(expected);
  });

  it("does not match RF-04 inside RF-040", () => {
    expect(extractTaskKeys("feat/RF-040-other", ["RF-04"])).toEqual([]);
  });

  it("matches RF-040 exactly when it is a known key", () => {
    expect(extractTaskKeys("feat/RF-040-other", known)).toEqual(["RF-040"]);
  });

  it("does not match a key preceded by alphanumerics", () => {
    expect(extractTaskKeys("XRF-04 and 1RF-04", ["RF-04"])).toEqual([]);
  });

  it.each([
    ["feat/AUTH-08b-return", ["AUTH-08B"]],
    ["feat/auth-08B", ["AUTH-08B"]],
    ["feat/AUTH-08-login", ["AUTH-08"]],
    ["AUTH-08 then AUTH-08b", ["AUTH-08", "AUTH-08B"]],
  ])("tells AUTH-08 and AUTH-08B apart in %j", (text, expected) => {
    expect(extractTaskKeys(text, ["AUTH-08", "AUTH-08B"])).toEqual(expected);
  });

  it("does not match a key followed by letters", () => {
    expect(extractTaskKeys("RF-04a", ["RF-04"])).toEqual([]);
  });

  it("matches a key preceded by a dash separator", () => {
    expect(extractTaskKeys("feat/XX-RF-04", ["RF-04"])).toEqual(["RF-04"]);
  });

  it("prefers the longest known key when keys overlap", () => {
    expect(extractTaskKeys("feat/RF-04-1-sub", ["RF-04", "RF-04-1"])).toEqual(["RF-04-1"]);
  });

  it("returns several keys in order of first appearance", () => {
    expect(extractTaskKeys("feat/E0-01-rf-04 [AB-7]", known)).toEqual(["E0-01", "RF-04", "AB-7"]);
  });

  it("deduplicates repeated keys regardless of casing", () => {
    expect(extractTaskKeys("RF-04 rf-04 Rf-04", known)).toEqual(["RF-04"]);
  });

  it("returns canonical casing from knownKeys", () => {
    expect(extractTaskKeys("feat/ab-7", known)).toEqual(["AB-7"]);
  });

  it("distinguishes E0-01 from E0-1", () => {
    expect(extractTaskKeys("E0-1 only", known)).toEqual(["E0-1"]);
    expect(extractTaskKeys("E0-01 only", known)).toEqual(["E0-01"]);
  });

  it("treats regex metacharacters in keys literally", () => {
    expect(extractTaskKeys("fix A.B-1", ["A.B-1"])).toEqual(["A.B-1"]);
    expect(extractTaskKeys("fix AXB-1", ["A.B-1"])).toEqual([]);
  });

  it("returns an empty list for empty text or no known keys", () => {
    expect(extractTaskKeys("", known)).toEqual([]);
    expect(extractTaskKeys("RF-04", [])).toEqual([]);
  });

  it("ignores empty known keys", () => {
    expect(extractTaskKeys("anything", [""])).toEqual([]);
  });
});
