import { describe, expect, it, vi } from "vitest";
import { createGithubOAuthHttpClient } from "./github-oauth-http-client.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const makeClient = (fetch: typeof globalThis.fetch) =>
  createGithubOAuthHttpClient({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://tasks.example.com/auth/github/callback",
    fetch,
  });

describe("createGithubOAuthHttpClient", () => {
  describe("exchangeCode", () => {
    it("posts the code to GitHub and returns the access token", async () => {
      const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        json({ access_token: "gho_abc", token_type: "bearer", scope: "" }),
      );
      const token = await makeClient(fetch).exchangeCode("the-code");

      expect(token).toBe("gho_abc");
      expect(fetch).toHaveBeenCalledOnce();
      const [url, init] = fetch.mock.calls[0]!;
      expect(String(url)).toBe("https://github.com/login/oauth/access_token");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("accept")).toBe("application/json");
      expect(JSON.parse(String(init?.body))).toEqual({
        client_id: "client-id",
        client_secret: "client-secret",
        code: "the-code",
        redirect_uri: "https://tasks.example.com/auth/github/callback",
      });
    });

    it("throws when GitHub answers with an OAuth error", async () => {
      const fetch = vi.fn(async () =>
        json({ error: "bad_verification_code", error_description: "The code is incorrect." }),
      );
      await expect(makeClient(fetch).exchangeCode("x")).rejects.toThrow("bad_verification_code");
    });

    it("throws on a non-2xx response", async () => {
      const fetch = vi.fn(async () => new Response("nope", { status: 500 }));
      await expect(makeClient(fetch).exchangeCode("x")).rejects.toThrow("500");
    });
  });

  describe("fetchUser", () => {
    const user = {
      id: 583231,
      login: "octocat",
      name: "The Octocat",
      avatar_url: "https://avatars.githubusercontent.com/u/583231",
      email: "octo@example.com",
    };

    it("reads the authenticated user with the access token", async () => {
      const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json(user));
      const profile = await makeClient(fetch).fetchUser("gho_abc");

      expect(profile).toEqual({
        githubId: 583231,
        login: "octocat",
        name: "The Octocat",
        avatarUrl: "https://avatars.githubusercontent.com/u/583231",
      });
      const [url, init] = fetch.mock.calls[0]!;
      expect(String(url)).toBe("https://api.github.com/user");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer gho_abc");
      expect(headers.get("accept")).toBe("application/vnd.github+json");
      expect(headers.get("user-agent")).toBeTruthy();
    });

    it("maps a missing name and avatar to null", async () => {
      const fetch = vi.fn(async () => json({ id: 1, login: "ghost", name: null }));
      expect(await makeClient(fetch).fetchUser("t")).toEqual({
        githubId: 1,
        login: "ghost",
        name: null,
        avatarUrl: null,
      });
    });

    it("throws on a non-2xx response", async () => {
      const fetch = vi.fn(async () => json({ message: "Bad credentials" }, 401));
      await expect(makeClient(fetch).fetchUser("t")).rejects.toThrow("401");
    });

    it("throws when the profile lacks an id or login", async () => {
      const fetch = vi.fn(async () => json({ login: "octocat" }));
      await expect(makeClient(fetch).fetchUser("t")).rejects.toThrow("unexpected");
    });
  });
});
