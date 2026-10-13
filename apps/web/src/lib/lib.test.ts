import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client.ts";
import { copyText } from "./clipboard.ts";
import { errorMessage } from "./error-messages.ts";
import { initials } from "./initials.ts";
import { compareTaskKeys } from "./task-labels.ts";
import { readStored, writeStored } from "./storage.ts";

describe("errorMessage", () => {
  it.each([
    ["dependency_cycle", "That would create a circular dependency."],
    ["dependency_exists", "This task already depends on that one."],
    ["self_dependency", "A task can’t depend on itself."],
    ["task_not_found", "There’s no task with that key in this project."],
    ["invalid_task_key", "Enter a task key, like ABC-7."],
    ["invalid_assignee", "That person can’t be assigned tasks in this project."],
    ["task_taken", "Someone else took this task first."],
    ["forbidden", "You don’t have permission to do that."],
    ["prefix_locked", "The prefix can’t change once the project has tasks."],
    ["invalid_github_login", "That isn’t a valid GitHub username."],
    ["already_admin", "That person is an admin, so they already have access to everything."],
    ["already_member", "That person is already a member."],
    ["member_not_found", "That person isn’t a member. Add them under Members first."],
    ["slug_taken", "Another project already uses that short key."],
    ["prefix_taken", "Another project already uses that prefix."],
    ["invalid_project_name", "Give the project a name of up to 100 characters."],
    ["invalid_project_slug", "Use lowercase letters, numbers and single hyphens (up to 50)."],
    ["invalid_task_key_prefix", "Use 1–10 letters or numbers, starting with a letter."],
    ["invalid_discord_channel_id", "A Discord channel ID is 17 to 20 digits."],
    ["invalid_repository_name", "Enter a repository as owner/repo."],
    ["repository_taken", "A project already has that repository."],
    ["repository_not_found", "That repository was already removed."],
    ["already_project_member", "That person is already in this project."],
    ["project_member_not_found", "That person was already removed from this project."],
  ])("maps %s to human copy", (code, message) => {
    expect(errorMessage(new ApiError(409, code))).toBe(message);
  });

  it("names the pending dependencies", () => {
    expect(errorMessage(new ApiError(409, "dependencies_pending", ["RF-13", "RF-15"]))).toBe(
      "Finish its dependencies first: RF-13, RF-15.",
    );
  });

  it("explains network failures", () => {
    expect(errorMessage(new ApiError(0, "network_error"))).toMatch(/can’t reach the server/i);
  });

  it("falls back to a generic message for unknown codes and non-API errors", () => {
    expect(errorMessage(new ApiError(500, "weird"))).toBe("Something went wrong. Try again.");
    expect(errorMessage(new Error("boom"))).toBe("Something went wrong. Try again.");
  });
});

describe("compareTaskKeys", () => {
  it("orders a key with a letter suffix right after the key without it", () => {
    const keys = ["AUTH-09", "AUTH-08B", "legacy", "AUTH-08", "AUTH-10"];
    expect([...keys].sort(compareTaskKeys)).toEqual(["AUTH-08", "AUTH-08B", "AUTH-09", "AUTH-10", "legacy"]);
  });
});

describe("initials", () => {
  it("uses the first letters of a two-word name", () => {
    expect(initials({ login: "annamiller", name: "Anna Miller" })).toBe("AM");
  });

  it("falls back to the first two letters of the login", () => {
    expect(initials({ login: "juanperez", name: null })).toBe("JU");
    expect(initials({ login: "x", name: "Single" })).toBe("SI");
  });
});

describe("storage", () => {
  it("round-trips a value", () => {
    writeStored("k", "v");
    expect(readStored("k")).toBe("v");
  });

  it("never throws when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(readStored("k")).toBeNull();
    expect(() => writeStored("k", "v")).not.toThrow();
  });
});

describe("copyText", () => {
  it("writes to the clipboard and reports success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyText("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("reports failure when the clipboard refuses", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    await expect(copyText("hello")).resolves.toBe(false);
  });

  it("reports failure when there is no clipboard", async () => {
    vi.stubGlobal("navigator", {});
    await expect(copyText("hello")).resolves.toBe(false);
  });
});
