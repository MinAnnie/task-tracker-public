import { normalizeGithubLogin } from "./github-login.ts";

/** 1–50 letters, digits or single hyphens, no leading or trailing hyphen. */
const PROJECT_SLUG = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,49}$/i;
const PROJECT_NAME_MAX_LENGTH = 100;
/** 1–10 letters or digits, starting with a letter (task keys look like `RF-14`). */
const TASK_KEY_PREFIX = /^[A-Z][A-Z0-9]{0,9}$/i;
/** Discord snowflake ids are 17–20 decimal digits. */
const DISCORD_CHANNEL_ID = /^[0-9]{17,20}$/;
/** GitHub repository names: 1–100 letters, digits, `-`, `_` or `.`. */
const GITHUB_REPOSITORY_NAME = /^[A-Za-z0-9._-]{1,100}$/;

/** Returns the lowercased slug when `value` is a valid project slug, `undefined` otherwise. */
export function normalizeProjectSlug(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Validate before case mapping: Unicode mappings such as "\u212A" → "k" must not sneak in.
  return PROJECT_SLUG.test(value) ? value.toLowerCase() : undefined;
}

/** Returns the trimmed name when it has 1–100 characters, `undefined` otherwise. */
export function normalizeProjectName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return name.length >= 1 && name.length <= PROJECT_NAME_MAX_LENGTH ? name : undefined;
}

/** Returns the uppercased prefix when `value` is a valid task key prefix, `undefined` otherwise. */
export function normalizeTaskKeyPrefix(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Validate before case mapping: Unicode mappings such as "ß" → "SS" must not sneak in.
  return TASK_KEY_PREFIX.test(value) ? value.toUpperCase() : undefined;
}

/**
 * Validates a Discord channel id. `null` means "no channel" and is returned as is;
 * anything that is neither `null` nor a valid id yields `undefined`.
 */
export function normalizeDiscordChannelId(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && DISCORD_CHANNEL_ID.test(value) ? value : undefined;
}

/**
 * Returns the lowercased `owner/repo` when `value` is a valid GitHub repository
 * full name, `undefined` otherwise. GitHub treats both parts case-insensitively.
 */
export function normalizeRepositoryFullName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parts = value.split("/");
  if (parts.length !== 2) return undefined;
  const [owner, repo = ""] = parts;
  const normalizedOwner = normalizeGithubLogin(owner);
  if (normalizedOwner === undefined) return undefined;
  if (!GITHUB_REPOSITORY_NAME.test(repo) || repo === "." || repo === "..") return undefined;
  return `${normalizedOwner}/${repo.toLowerCase()}`;
}
