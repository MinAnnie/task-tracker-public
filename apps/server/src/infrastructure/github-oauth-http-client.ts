import type { GithubUserProfile } from "../application/auth-store.ts";
import type { GithubOAuthClient } from "../application/complete-github-login.ts";

const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
/** GitHub's REST API rejects requests without a User-Agent. */
const USER_AGENT = "task-tracker";

export interface GithubOAuthHttpClientOptions {
  clientId: string;
  clientSecret: string;
  /** Must match the `redirect_uri` sent to the authorize endpoint. */
  redirectUri: string;
  fetch?: typeof globalThis.fetch;
}

/** HTTP adapter for {@link GithubOAuthClient} using GitHub's OAuth web flow and REST API. */
export function createGithubOAuthHttpClient({
  clientId,
  clientSecret,
  redirectUri,
  fetch = globalThis.fetch,
}: GithubOAuthHttpClientOptions): GithubOAuthClient {
  return {
    async exchangeCode(code) {
      const res = await fetch(ACCESS_TOKEN_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": USER_AGENT,
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!res.ok) throw new Error(`GitHub token exchange failed with status ${res.status}`);

      // GitHub reports OAuth errors (e.g. an expired code) with a 200 status.
      const body = (await res.json()) as { access_token?: unknown; error?: unknown };
      if (typeof body.access_token === "string" && body.access_token.length > 0) {
        return body.access_token;
      }
      throw new Error(`GitHub token exchange failed: ${String(body.error ?? "no access_token")}`);
    },

    async fetchUser(accessToken) {
      const res = await fetch(USER_URL, {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${accessToken}`,
          "user-agent": USER_AGENT,
          "x-github-api-version": "2022-11-28",
        },
      });
      if (!res.ok) throw new Error(`GitHub user request failed with status ${res.status}`);
      return toProfile(await res.json());
    },
  };
}

function toProfile(body: unknown): GithubUserProfile {
  const user = (body ?? {}) as Record<string, unknown>;
  if (!Number.isSafeInteger(user.id) || typeof user.login !== "string" || user.login === "") {
    throw new Error("GitHub user response has an unexpected shape");
  }
  return {
    githubId: user.id as number,
    login: user.login,
    name: typeof user.name === "string" ? user.name : null,
    avatarUrl: typeof user.avatar_url === "string" ? user.avatar_url : null,
  };
}
