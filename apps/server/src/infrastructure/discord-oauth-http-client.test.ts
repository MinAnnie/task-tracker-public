import { describe, expect, it, vi } from "vitest";
import { createDiscordOAuthHttpClient } from "./discord-oauth-http-client.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const makeClient = (fetch: typeof globalThis.fetch) =>
  createDiscordOAuthHttpClient({
    clientId: "1234",
    clientSecret: "client-secret",
    redirectUri: "https://tasks.example.com/auth/discord/callback",
    fetch,
  });

describe("createDiscordOAuthHttpClient", () => {
  describe("exchangeCode", () => {
    it("posts a form-encoded authorization_code grant and returns the access token", async () => {
      const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        json({ access_token: "discord-token", token_type: "Bearer", scope: "identify" }),
      );
      const token = await makeClient(fetch).exchangeCode("the-code");

      expect(token).toBe("discord-token");
      expect(fetch).toHaveBeenCalledOnce();
      const [url, init] = fetch.mock.calls[0]!;
      expect(String(url)).toBe("https://discord.com/api/oauth2/token");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded");
      expect(headers.get("accept")).toBe("application/json");
      expect(init?.body).toBeInstanceOf(URLSearchParams);
      expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
        client_id: "1234",
        client_secret: "client-secret",
        grant_type: "authorization_code",
        code: "the-code",
        redirect_uri: "https://tasks.example.com/auth/discord/callback",
      });
    });

    it("throws with Discord's OAuth error code on a refused grant", async () => {
      const fetch = vi.fn(async () =>
        json({ error: "invalid_grant", error_description: 'Invalid "code" in request.' }, 400),
      );
      await expect(makeClient(fetch).exchangeCode("x")).rejects.toThrow("invalid_grant");
    });

    it("throws with the status on a non-JSON error response", async () => {
      const fetch = vi.fn(async () => new Response("nope", { status: 500 }));
      await expect(makeClient(fetch).exchangeCode("x")).rejects.toThrow("500");
    });

    it("throws when a successful response has no access token", async () => {
      const fetch = vi.fn(async () => json({ token_type: "Bearer" }));
      await expect(makeClient(fetch).exchangeCode("x")).rejects.toThrow("no access_token");
    });

    it("never puts the client secret or the code in its errors", async () => {
      const fetch = vi.fn(async () => json({ error: "invalid_client" }, 401));
      const error = await makeClient(fetch).exchangeCode("the-code").then(
        () => expect.unreachable(),
        (e: unknown) => e as Error,
      );
      expect(error.message).not.toContain("client-secret");
      expect(error.message).not.toContain("the-code");
    });
  });

  describe("fetchUser", () => {
    const user = {
      id: "80351110224678912",
      username: "nelly",
      global_name: "Nelly",
      discriminator: "0",
      avatar: null,
    };

    it("reads the current user with the access token, preferring the display name", async () => {
      const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json(user));
      const account = await makeClient(fetch).fetchUser("discord-token");

      expect(account).toEqual({ id: "80351110224678912", username: "Nelly" });
      const [url, init] = fetch.mock.calls[0]!;
      expect(String(url)).toBe("https://discord.com/api/v10/users/@me");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer discord-token");
    });

    it("falls back to the username when there is no display name", async () => {
      const fetch = vi.fn(async () => json({ ...user, global_name: null }));
      expect(await makeClient(fetch).fetchUser("t")).toEqual({ id: user.id, username: "nelly" });
    });

    it("throws on a non-2xx response without echoing the token", async () => {
      const fetch = vi.fn(async () => json({ message: "401: Unauthorized", code: 0 }, 401));
      const error = await makeClient(fetch).fetchUser("discord-token").then(
        () => expect.unreachable(),
        (e: unknown) => e as Error,
      );
      expect(error.message).toContain("401");
      expect(error.message).not.toContain("discord-token");
    });

    it.each([
      ["the id is missing", { username: "nelly" }],
      ["the id is not a snowflake", { id: 42, username: "nelly" }],
      ["the username is missing", { id: "80351110224678912" }],
    ])("throws when %s", async (_case, body) => {
      const fetch = vi.fn(async () => json(body));
      await expect(makeClient(fetch).fetchUser("t")).rejects.toThrow("unexpected");
    });
  });
});
