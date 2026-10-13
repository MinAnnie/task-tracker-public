import { resolve } from "node:path";
import { isDiscordPublicKey } from "./webhooks/discord/verify-signature.ts";

export interface Config {
  databaseUrl: string;
  githubWebhookSecret: string;
  githubClientId: string;
  githubClientSecret: string;
  /** Lowercased GitHub logins with the admin role; never empty. Members live in the database. */
  adminGithubLogins: string[];
  /** Public origin of the app (e.g. `https://tasks.example.com`), without a trailing slash. */
  appBaseUrl: string;
  port: number;
  webDistDir: string | undefined;
  /** Discord bot token; when unset, Discord notifications are disabled. Never log it. */
  discordBotToken: string | undefined;
  /** Discord OAuth2 app used to link accounts; when unset, linking is disabled. Never log the secret. */
  discordOAuth: DiscordOAuthConfig | undefined;
  /** Lowercased hex Ed25519 key of the Discord app; when unset, slash commands are disabled. */
  discordPublicKey: string | undefined;
}

export interface DiscordOAuthConfig {
  /** The Discord application id, used as the OAuth2 client id. */
  applicationId: string;
  clientSecret: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const githubWebhookSecret = env.GITHUB_WEBHOOK_SECRET;
  if (!githubWebhookSecret) throw new Error("GITHUB_WEBHOOK_SECRET is required");

  const githubClientId = env.GITHUB_CLIENT_ID;
  if (!githubClientId) throw new Error("GITHUB_CLIENT_ID is required");

  const githubClientSecret = env.GITHUB_CLIENT_SECRET;
  if (!githubClientSecret) throw new Error("GITHUB_CLIENT_SECRET is required");

  const adminGithubLogins = (env.ADMIN_GITHUB_LOGINS ?? "")
    .split(",")
    .map((login) => login.trim().toLowerCase())
    .filter((login) => login.length > 0);
  if (adminGithubLogins.length === 0) {
    throw new Error("ADMIN_GITHUB_LOGINS must list at least one GitHub login");
  }

  const appBaseUrl = parseAppBaseUrl(env.APP_BASE_URL);

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid PORT: ${env.PORT}`);

  return {
    databaseUrl,
    githubWebhookSecret,
    githubClientId,
    githubClientSecret,
    adminGithubLogins,
    appBaseUrl,
    port,
    webDistDir: env.WEB_DIST_DIR ? resolve(env.WEB_DIST_DIR) : undefined,
    discordBotToken: env.DISCORD_BOT_TOKEN?.trim() || undefined,
    discordOAuth: parseDiscordOAuth(env),
    discordPublicKey: parseDiscordPublicKey(env.DISCORD_PUBLIC_KEY),
  };
}

/** Both values enable account linking, neither disables it; one alone is a configuration error. */
function parseDiscordOAuth(env: NodeJS.ProcessEnv): DiscordOAuthConfig | undefined {
  const applicationId = env.DISCORD_APPLICATION_ID?.trim() || undefined;
  const clientSecret = env.DISCORD_CLIENT_SECRET?.trim() || undefined;
  if (applicationId === undefined && clientSecret === undefined) return undefined;
  if (applicationId === undefined || clientSecret === undefined) {
    throw new Error("DISCORD_APPLICATION_ID and DISCORD_CLIENT_SECRET must be set together");
  }
  return { applicationId, clientSecret };
}

/** The app's public key (Developer Portal → General Information) verifies interaction requests. */
function parseDiscordPublicKey(value: string | undefined): string | undefined {
  const key = value?.trim() || undefined;
  if (key === undefined) return undefined;
  if (!isDiscordPublicKey(key)) throw new Error("DISCORD_PUBLIC_KEY must be 64 hexadecimal characters");
  return key.toLowerCase();
}

/** Accepts only a bare http(s) origin; the OAuth callback URL is derived from it. */
export function parseAppBaseUrl(value: string | undefined): string {
  if (!value) throw new Error("APP_BASE_URL is required");
  const url = URL.parse(value);
  const isOrigin =
    url !== null &&
    (url.protocol === "https:" || url.protocol === "http:") &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "";
  if (!isOrigin) throw new Error(`Invalid APP_BASE_URL: ${value}`);
  return url.origin;
}
