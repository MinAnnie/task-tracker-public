import { describe, expect, it } from "vitest";
import { normalizeGithubLogin } from "./github-login.ts";

describe("normalizeGithubLogin", () => {
  it.each([
    ["octocat", "octocat"],
    ["OctoCat", "octocat"],
    ["a", "a"],
    ["mona-lisa", "mona-lisa"],
    ["a-b-c", "a-b-c"],
    ["user123", "user123"],
    ["a".repeat(39), "a".repeat(39)],
  ])("accepts %j as %j", (input, expected) => {
    expect(normalizeGithubLogin(input)).toBe(expected);
  });

  it.each([
    [""],
    ["a".repeat(40)],
    ["-octocat"],
    ["octocat-"],
    ["octo--cat"],
    ["octo_cat"],
    ["octo cat"],
    [" octocat"],
    ["octo.cat"],
    ["ócto"],
  ])("rejects %j", (input) => {
    expect(normalizeGithubLogin(input)).toBeUndefined();
  });

  it("rejects non-string values", () => {
    for (const value of [undefined, null, 42, {}, ["octocat"]]) {
      expect(normalizeGithubLogin(value)).toBeUndefined();
    }
  });
});
