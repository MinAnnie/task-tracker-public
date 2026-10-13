import { describe, expect, it } from "vitest";
import { resolveRole } from "./resolve-role.ts";

describe("resolveRole", () => {
  const admins = ["octocat", "hubot"];

  it("returns admin for a login listed as admin, case-insensitively", () => {
    expect(resolveRole("OctoCat", admins, false)).toBe("admin");
  });

  it("lets admin win over member", () => {
    expect(resolveRole("hubot", admins, true)).toBe("admin");
  });

  it("returns member for a non-admin member", () => {
    expect(resolveRole("mona", admins, true)).toBe("member");
  });

  it("returns null for a login that is neither admin nor member", () => {
    expect(resolveRole("mallory", admins, false)).toBeNull();
  });

  it("returns null when there are no admins and the login is not a member", () => {
    expect(resolveRole("octocat", [], false)).toBeNull();
  });
});
