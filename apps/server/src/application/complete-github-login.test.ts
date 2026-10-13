import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuthStore } from "../../test/fakes/in-memory-auth-store.ts";
import type { GithubUserProfile } from "./auth-store.ts";
import {
  completeGithubLogin,
  SESSION_TTL_MS,
  type CompleteGithubLoginDeps,
  type GithubOAuthClient,
} from "./complete-github-login.ts";
import { hashSessionToken } from "./session-token.ts";

const now = new Date("2026-03-01T12:00:00Z");

const octocat: GithubUserProfile = {
  githubId: 583231,
  login: "OctoCat",
  name: "The Octocat",
  avatarUrl: "https://avatars.githubusercontent.com/u/583231",
};

class FakeGithubOAuthClient implements GithubOAuthClient {
  exchangedCodes: string[] = [];
  profileRequests: string[] = [];
  profile: GithubUserProfile = octocat;

  async exchangeCode(code: string) {
    this.exchangedCodes.push(code);
    return `token-for-${code}`;
  }

  async fetchUser(accessToken: string) {
    this.profileRequests.push(accessToken);
    return this.profile;
  }
}

describe("completeGithubLogin", () => {
  let store: InMemoryAuthStore;
  let github: FakeGithubOAuthClient;
  let deps: CompleteGithubLoginDeps;

  beforeEach(() => {
    store = new InMemoryAuthStore();
    github = new FakeGithubOAuthClient();
    deps = {
      store,
      github,
      adminLogins: ["octocat", "hubot"],
      now: () => now,
      generateToken: () => "session-token",
    };
  });

  it("exchanges the code and fetches the profile with the resulting access token", async () => {
    await completeGithubLogin(deps, "the-code");
    expect(github.exchangedCodes).toEqual(["the-code"]);
    expect(github.profileRequests).toEqual(["token-for-the-code"]);
  });

  it("creates the user and a session for an admin login, matching case-insensitively", async () => {
    const result = await completeGithubLogin(deps, "code");

    expect(result).toEqual({
      status: "authenticated",
      userId: 1,
      sessionToken: "session-token",
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    });
    expect(store.users).toEqual([{ ...octocat, id: 1 }]);
    expect(store.sessions).toEqual([
      {
        id: 1,
        userId: 1,
        tokenHash: hashSessionToken("session-token"),
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      },
    ]);
    expect(store.transactions).toBe(1);
  });

  it("uses a 30 day session lifetime", () => {
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("never stores the raw session token", async () => {
    await completeGithubLogin(deps, "code");
    expect(JSON.stringify(store.sessions)).not.toContain('"session-token"');
  });

  it("updates the profile of a returning user instead of creating a new one", async () => {
    await completeGithubLogin(deps, "first");
    github.profile = { ...octocat, login: "hubot", name: "Renamed", avatarUrl: null };
    let tokens = 0;
    const result = await completeGithubLogin(
      { ...deps, generateToken: () => `second-token-${++tokens}` },
      "second",
    );

    expect(result).toMatchObject({ status: "authenticated", userId: 1 });
    expect(store.users).toEqual([
      { id: 1, githubId: octocat.githubId, login: "hubot", name: "Renamed", avatarUrl: null },
    ]);
    expect(store.sessions).toHaveLength(2);
  });

  it("signs in a member who is not an admin, matching the member login case-insensitively", async () => {
    await store.addMember({ githubLogin: "mona", addedByUserId: null });
    github.profile = { ...octocat, login: "Mona" };

    const result = await completeGithubLogin(deps, "code");

    expect(result).toMatchObject({ status: "authenticated", userId: 1 });
    expect(store.users.map((u) => u.login)).toEqual(["Mona"]);
    expect(store.sessions).toHaveLength(1);
  });

  it("rejects a login that is neither admin nor member without creating a user or session", async () => {
    await store.addMember({ githubLogin: "mona", addedByUserId: null });
    github.profile = { ...octocat, login: "mallory" };
    const result = await completeGithubLogin(deps, "code");

    expect(result).toEqual({ status: "forbidden", login: "mallory" });
    expect(store.users).toEqual([]);
    expect(store.sessions).toEqual([]);
    expect(store.transactions).toBe(0);
  });

  it("propagates GitHub failures without touching the store", async () => {
    github.exchangeCode = async () => {
      throw new Error("bad_verification_code");
    };
    await expect(completeGithubLogin(deps, "code")).rejects.toThrow("bad_verification_code");
    expect(store.users).toEqual([]);
  });
});
