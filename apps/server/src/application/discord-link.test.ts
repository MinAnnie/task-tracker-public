import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuthStore } from "../../test/fakes/in-memory-auth-store.ts";
import type { DiscordAccount } from "./auth-store.ts";
import {
  completeDiscordLink,
  findDiscordAccount,
  unlinkDiscordAccount,
  type DiscordOAuthClient,
} from "./discord-link.ts";

const nelly: DiscordAccount = { id: "80351110224678912", username: "Nelly" };

class FakeDiscordOAuthClient implements DiscordOAuthClient {
  exchangedCodes: string[] = [];
  userRequests: string[] = [];
  account: DiscordAccount = nelly;

  async exchangeCode(code: string) {
    this.exchangedCodes.push(code);
    return `token-for-${code}`;
  }

  async fetchUser(accessToken: string) {
    this.userRequests.push(accessToken);
    return this.account;
  }
}

describe("Discord account linking", () => {
  let store: InMemoryAuthStore;
  let discord: FakeDiscordOAuthClient;
  let octocatId: number;
  let monaId: number;

  beforeEach(async () => {
    store = new InMemoryAuthStore();
    discord = new FakeDiscordOAuthClient();
    octocatId = (await store.upsertUserByGithubId({ githubId: 1, login: "octocat", name: null, avatarUrl: null })).id;
    monaId = (await store.upsertUserByGithubId({ githubId: 2, login: "mona", name: null, avatarUrl: null })).id;
  });

  describe("completeDiscordLink", () => {
    it("exchanges the code and reads the Discord user with the resulting token", async () => {
      await completeDiscordLink({ store, discord }, octocatId, "the-code");
      expect(discord.exchangedCodes).toEqual(["the-code"]);
      expect(discord.userRequests).toEqual(["token-for-the-code"]);
    });

    it("links the Discord account to the user inside a transaction", async () => {
      const result = await completeDiscordLink({ store, discord }, octocatId, "code");

      expect(result).toEqual({ status: "linked", account: nelly });
      expect(await store.findDiscordAccount(octocatId)).toEqual(nelly);
      expect(store.transactions).toBe(1);
    });

    it("refuses, changing nothing, when the Discord account is linked to another user", async () => {
      await store.setDiscordAccount(monaId, nelly);
      await store.setDiscordAccount(octocatId, { id: "1", username: "old" });

      const result = await completeDiscordLink({ store, discord }, octocatId, "code");

      expect(result).toEqual({ status: "already_linked" });
      expect(await store.findDiscordAccount(monaId)).toEqual(nelly);
      expect(await store.findDiscordAccount(octocatId)).toEqual({ id: "1", username: "old" });
    });

    it("refreshes the display name when the user links the same account again", async () => {
      await store.setDiscordAccount(octocatId, { ...nelly, username: "old name" });

      const result = await completeDiscordLink({ store, discord }, octocatId, "code");

      expect(result).toEqual({ status: "linked", account: nelly });
      expect(await store.findDiscordAccount(octocatId)).toEqual(nelly);
    });

    it("replaces the user's previous Discord account with a different one", async () => {
      await store.setDiscordAccount(octocatId, { id: "1", username: "old" });

      await completeDiscordLink({ store, discord }, octocatId, "code");

      expect(await store.findDiscordAccount(octocatId)).toEqual(nelly);
      expect(await store.findUserIdByDiscordId("1")).toBeUndefined();
    });

    it("propagates Discord failures without linking anything", async () => {
      discord.exchangeCode = async () => {
        throw new Error("invalid_grant");
      };
      await expect(completeDiscordLink({ store, discord }, octocatId, "code")).rejects.toThrow("invalid_grant");
      expect(await store.findDiscordAccount(octocatId)).toBeNull();
    });
  });

  describe("unlinkDiscordAccount", () => {
    it("clears the user's Discord account and leaves others alone", async () => {
      await store.setDiscordAccount(octocatId, nelly);
      await store.setDiscordAccount(monaId, { id: "2", username: "mona" });

      await unlinkDiscordAccount(store, octocatId);

      expect(await store.findDiscordAccount(octocatId)).toBeNull();
      expect(await store.findDiscordAccount(monaId)).toEqual({ id: "2", username: "mona" });
    });

    it("is a no-op for a user without a Discord account", async () => {
      await unlinkDiscordAccount(store, octocatId);
      expect(await store.findDiscordAccount(octocatId)).toBeNull();
    });
  });

  describe("findDiscordAccount", () => {
    it("returns the linked account or null", async () => {
      await store.setDiscordAccount(octocatId, nelly);
      expect(await findDiscordAccount(store, octocatId)).toEqual(nelly);
      expect(await findDiscordAccount(store, monaId)).toBeNull();
    });
  });
});
