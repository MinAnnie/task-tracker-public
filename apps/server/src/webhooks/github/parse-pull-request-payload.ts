import type { PullRequestEventInput } from "../../application/handle-pull-request-event.ts";

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const asInteger = (value: unknown): number | undefined =>
  Number.isInteger(value) ? (value as number) : undefined;

/** Parses an ISO timestamp; `null` stays `null`, anything unparsable yields `undefined`. */
const asNullableDate = (value: unknown): Date | null | undefined => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/**
 * Validates a GitHub `pull_request` webhook payload and maps it to the use case input.
 * Returns `undefined` when a required field is missing or has the wrong type.
 */
export function parsePullRequestPayload(value: unknown): PullRequestEventInput | undefined {
  if (!isObject(value)) return undefined;
  const { action, repository, pull_request: pr, installation } = value;
  if (!isObject(repository) || !isObject(pr)) return undefined;
  if (!isObject(pr.user) || !isObject(pr.head)) return undefined;

  const fullName = asString(repository.full_name);
  const number = asInteger(pr.number);
  const title = asString(pr.title);
  const branch = asString(pr.head.ref);
  const url = asString(pr.html_url);
  const authorLogin = asString(pr.user.login);
  const state = pr.state === "open" || pr.state === "closed" ? pr.state : undefined;
  const createdAt = asNullableDate(pr.created_at);
  const mergedAt = asNullableDate(pr.merged_at);
  const closedAt = asNullableDate(pr.closed_at);
  const installationId = isObject(installation) ? (asInteger(installation.id) ?? null) : null;

  if (
    typeof action !== "string" ||
    fullName === undefined ||
    number === undefined ||
    title === undefined ||
    branch === undefined ||
    url === undefined ||
    authorLogin === undefined ||
    state === undefined ||
    createdAt === undefined ||
    createdAt === null ||
    mergedAt === undefined ||
    closedAt === undefined
  ) {
    return undefined;
  }

  return {
    action,
    repositoryFullName: fullName,
    installationId,
    pullRequest: {
      number,
      title,
      branch,
      url,
      authorLogin,
      state,
      merged: pr.merged === true,
      createdAt,
      mergedAt,
      closedAt,
    },
  };
}
