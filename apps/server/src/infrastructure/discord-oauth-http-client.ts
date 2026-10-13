import type { DiscordAccount } from "../application/auth-store.ts";
import type { DiscordOAuthClient } from "../application/discord-link.ts";

const TOKEN_URL = "https://discord.com/api/oauth2/token";
const CURRENT_USER_URL = "https://discord.com/api/v10/users/@me";
/** Discord user ids are snowflakes: unsigned 64-bit integers sent as decimal strings. */
const SNOWFLAKE = /^\d{1,20}$/;

export interface DiscordOAuthHttpClientOptions {
  /** The Discord application id. */
  clientId: string;
  clientSecret: string;
  /** Must match the `redirect_uri` sent to the authorize endpoint. */
  redirectUri: string;
  fetch?: typeof globalThis.fetch;
}

/** HTTP adapter for {@link DiscordOAuthClient} using Discord's OAuth2 code grant and REST API. */
export function createDiscordOAuthHttpClient({
  clientId,
  clientSecret,
  redirectUri,
  fetch = globalThis.fetch,
}: DiscordOAuthHttpClientOptions): DiscordOAuthClient {
  return {
    async exchangeCode(code) {
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { access_token?: unknown; error?: unknown };
      if (!res.ok) {
        const reason = typeof body.error === "string" ? `: ${body.error}` : "";
        throw new Error(`Discord token exchange failed with status ${res.status}${reason}`);
      }
      if (typeof body.access_token === "string" && body.access_token.length > 0) {
        return body.access_token;
      }
      throw new Error("Discord token exchange failed: no access_token");
    },

    async fetchUser(accessToken) {
      const res = await fetch(CURRENT_USER_URL, {
        headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`Discord user request failed with status ${res.status}`);
      return toAccount(await res.json());
    },
  };
}

function toAccount(body: unknown): DiscordAccount {
  const user = (body ?? {}) as Record<string, unknown>;
  if (typeof user.id !== "string" || !SNOWFLAKE.test(user.id)) {
    throw new Error("Discord user response has an unexpected shape");
  }
  const displayName = typeof user.global_name === "string" && user.global_name !== "" ? user.global_name : undefined;
  const username = displayName ?? (typeof user.username === "string" ? user.username : "");
  if (username === "") throw new Error("Discord user response has an unexpected shape");
  return { id: user.id, username };
}
