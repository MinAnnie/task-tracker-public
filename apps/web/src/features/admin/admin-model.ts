import { isApiError } from "../../api/client.ts";
import type { ApiToken, NewProjectInput } from "../../api/types.ts";
import { errorMessage } from "../../lib/error-messages.ts";

/** The server's GitHub username rule: 1–39 alphanumerics or single hyphens, no hyphen at either end. */
const GITHUB_LOGIN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i;
/** The server's project slug rule. */
const PROJECT_SLUG = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,49}$/;
const SLUG_MAX = 50;
const NAME_MAX = 100;
/** The server's task key prefix rule (case-insensitive; stored uppercased). */
const TASK_KEY_PREFIX = /^[A-Z][A-Z0-9]{0,9}$/i;
const DISCORD_CHANNEL_ID = /^[0-9]{17,20}$/;
const REPOSITORY_NAME = /^[A-Za-z0-9._-]{1,100}$/;

export const INVALID_LOGIN = "That isn’t a valid GitHub username.";
const INVALID_REPOSITORY = "Enter a repository as owner/repo.";

/** Parses a typed GitHub username (a leading `@` is fine) into the lowercased login. */
export function parseGithubLogin(raw: string): { login: string } | { error: string } {
  const value = raw.trim().replace(/^@/, "");
  if (value === "") return { error: "Enter a GitHub username." };
  return GITHUB_LOGIN.test(value) ? { login: value.toLowerCase() } : { error: INVALID_LOGIN };
}

/** Parses a typed `owner/repo`, following the server's rules. */
export function parseRepositoryName(raw: string): { fullName: string } | { error: string } {
  const value = raw.trim();
  const parts = value.split("/");
  if (parts.length !== 2) return { error: INVALID_REPOSITORY };
  const [owner = "", repo = ""] = parts;
  const valid = GITHUB_LOGIN.test(owner) && REPOSITORY_NAME.test(repo) && repo !== "." && repo !== "..";
  return valid ? { fullName: value } : { error: INVALID_REPOSITORY };
}

/** Letter-and-digit words of a name, accents removed. */
const words = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);

/** A URL-safe slug for a project name, e.g. "Acme Mobile" → "acme-mobile". */
export function slugFromName(name: string): string {
  return words(name).join("-").toLowerCase().slice(0, SLUG_MAX).replace(/-+$/, "");
}

/**
 * A task key prefix suggested from a project name: the initials of a multi-word
 * name (up to 4), or the first three characters of a single word. Leading digits
 * are skipped, since prefixes start with a letter.
 */
export function suggestTaskKeyPrefix(name: string): string {
  const parts = words(name)
    .map((word) => word.replace(/^[0-9]+/, ""))
    .filter(Boolean);
  const prefix = parts.length > 1 ? parts.slice(0, 4).map((word) => word[0]).join("") : (parts[0] ?? "").slice(0, 3);
  return prefix.toUpperCase();
}

export interface ProjectValues {
  name: string;
  slug: string;
  taskKeyPrefix: string;
  /** Blank means no channel. */
  discordChannelId: string;
}

export type ProjectErrors = Partial<Record<keyof ProjectValues, string>>;

export const EMPTY_PROJECT: ProjectValues = { name: "", slug: "", taskKeyPrefix: "", discordChannelId: "" };

export function validateProjectValues(values: ProjectValues): ProjectErrors {
  const errors: ProjectErrors = {};
  const name = values.name.trim();
  if (name === "") errors.name = "Give the project a name.";
  else if (name.length > NAME_MAX) errors.name = "Keep the name under 100 characters.";
  if (!PROJECT_SLUG.test(values.slug.trim())) {
    errors.slug = "Use lowercase letters, numbers and single hyphens (up to 50).";
  }
  if (!TASK_KEY_PREFIX.test(values.taskKeyPrefix.trim())) {
    errors.taskKeyPrefix = "Use 1–10 letters or numbers, starting with a letter.";
  }
  const discord = values.discordChannelId.trim();
  if (discord !== "" && !DISCORD_CHANNEL_ID.test(discord)) {
    errors.discordChannelId = "A Discord channel ID is 17 to 20 digits.";
  }
  return errors;
}

/** A server refusal of a project form: its message and, when one field caused it, that field. */
export interface ProjectFailure {
  message: string;
  field?: keyof ProjectValues;
}

const FAILURE_FIELDS: Record<string, keyof ProjectValues> = {
  invalid_project_name: "name",
  invalid_project_slug: "slug",
  slug_taken: "slug",
  invalid_task_key_prefix: "taskKeyPrefix",
  prefix_taken: "taskKeyPrefix",
  prefix_locked: "taskKeyPrefix",
  invalid_discord_channel_id: "discordChannelId",
};

export function projectFailure(error: unknown): ProjectFailure {
  const field = isApiError(error) ? FAILURE_FIELDS[error.code] : undefined;
  return field ? { message: errorMessage(error), field } : { message: errorMessage(error) };
}

/** Client-side errors first; otherwise the server's, on the field that caused it. */
export function fieldErrors(errors: ProjectErrors, failure: ProjectFailure | undefined): ProjectErrors {
  if (failure?.field === undefined || errors[failure.field]) return errors;
  return { ...errors, [failure.field]: failure.message };
}

/** The request body: trimmed, prefix uppercased, a blank Discord channel as `null`. */
export function toProjectInput(values: ProjectValues): NewProjectInput {
  const discord = values.discordChannelId.trim();
  return {
    name: values.name.trim(),
    slug: values.slug.trim(),
    taskKeyPrefix: values.taskKeyPrefix.trim().toUpperCase(),
    discordChannelId: discord === "" ? null : discord,
  };
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/** "Oct 9, 2026". */
export const formatAddedOn = (iso: string) => DATE_FORMAT.format(new Date(iso));

/** "1 task", "2 tasks". */
export const countLabel = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const API_TOKEN_NAME_MAX = 60;
const INVALID_API_TOKEN_NAME = "Give the token a name of up to 60 characters.";

/** Choices of the token lifetime select; the value is days, or `never`. 90 days is the default. */
export const API_TOKEN_EXPIRY_OPTIONS = [
  { value: "30", label: "In 30 days" },
  { value: "90", label: "In 90 days" },
  { value: "365", label: "In 365 days" },
  { value: "never", label: "Never" },
] as const;

/** The server's token name rule: 1–60 characters once trimmed. */
export function parseApiTokenName(raw: string): { name: string } | { error: string } {
  const name = raw.trim();
  return name.length >= 1 && name.length <= API_TOKEN_NAME_MAX ? { name } : { error: INVALID_API_TOKEN_NAME };
}

/** Facts shown under a token: who created it and when, last use, expiry and revocation. */
export function apiTokenDetails(token: ApiToken): string[] {
  const created = `Created ${formatAddedOn(token.createdAt)}${token.createdBy ? ` by @${token.createdBy}` : ""}`;
  const used = token.lastUsedAt ? `Last used ${formatAddedOn(token.lastUsedAt)}` : "Never used";
  let expiry = "Never expires";
  if (token.expiresAt !== null) {
    expiry = `${token.status === "expired" ? "Expired" : "Expires"} ${formatAddedOn(token.expiresAt)}`;
  }
  const details = [created, used, expiry];
  if (token.revokedAt !== null) details.push(`Revoked ${formatAddedOn(token.revokedAt)}`);
  return details;
}

/** A ready-to-run example that reads the token from `$TRACKER_API_TOKEN`, so the secret never lands in it. */
export const apiTokenUsageHint = (origin: string, slug: string) =>
  `curl -H "Authorization: Bearer $TRACKER_API_TOKEN" ${origin}/api/projects/${encodeURIComponent(slug)}/tasks`;
