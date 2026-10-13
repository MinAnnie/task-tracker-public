import { describe, expect, it } from "vitest";
import { parsePullRequestPayload } from "./parse-pull-request-payload.ts";

const payload = () => ({
  action: "closed",
  number: 7,
  installation: { id: 99 },
  repository: { full_name: "acme/shop" },
  pull_request: {
    number: 7,
    title: "RF-04 checkout",
    html_url: "https://github.com/acme/shop/pull/7",
    state: "closed",
    merged: true,
    created_at: "2026-01-01T10:00:00Z",
    merged_at: "2026-01-02T10:00:00Z",
    closed_at: "2026-01-02T10:00:00Z",
    user: { login: "octocat" },
    head: { ref: "feat/RF-04" },
  },
});

describe("parsePullRequestPayload", () => {
  it("maps a pull_request payload to the use case input", () => {
    expect(parsePullRequestPayload(payload())).toEqual({
      action: "closed",
      repositoryFullName: "acme/shop",
      installationId: 99,
      pullRequest: {
        number: 7,
        title: "RF-04 checkout",
        branch: "feat/RF-04",
        url: "https://github.com/acme/shop/pull/7",
        authorLogin: "octocat",
        state: "closed",
        merged: true,
        createdAt: new Date("2026-01-01T10:00:00Z"),
        mergedAt: new Date("2026-01-02T10:00:00Z"),
        closedAt: new Date("2026-01-02T10:00:00Z"),
      },
    });
  });

  it("accepts open pull requests with null dates, no merged flag and no installation", () => {
    const value = payload();
    const { installation: _, ...withoutInstallation } = value;
    const pr = {
      ...value.pull_request,
      state: "open",
      merged: undefined,
      merged_at: null,
      closed_at: null,
    };
    expect(parsePullRequestPayload({ ...withoutInstallation, pull_request: pr })).toMatchObject({
      installationId: null,
      pullRequest: { state: "open", merged: false, mergedAt: null, closedAt: null },
    });
  });

  it.each([
    ["a non-object", "nope"],
    ["null", null],
    ["a missing action", { ...payload(), action: undefined }],
    ["a missing repository", { ...payload(), repository: undefined }],
    ["a missing pull_request", { ...payload(), pull_request: undefined }],
    ["a non-numeric number", { ...payload(), pull_request: { ...payload().pull_request, number: "7" } }],
    ["a missing head ref", { ...payload(), pull_request: { ...payload().pull_request, head: {} } }],
    ["an unknown state", { ...payload(), pull_request: { ...payload().pull_request, state: "draft" } }],
    ["an invalid date", { ...payload(), pull_request: { ...payload().pull_request, created_at: "x" } }],
  ])("rejects %s", (_label, value) => {
    expect(parsePullRequestPayload(value)).toBeUndefined();
  });
});
