import { describe, expect, it } from "vitest";
import {
  apiTokenDetails,
  apiTokenUsageHint,
  formatAddedOn,
  parseApiTokenName,
  parseGithubLogin,
  parseRepositoryName,
  slugFromName,
  suggestTaskKeyPrefix,
  toProjectInput,
  validateProjectValues,
} from "./admin-model.ts";

describe("parseGithubLogin", () => {
  it("accepts a GitHub username, with or without a leading @, lowercased", () => {
    expect(parseGithubLogin(" @Maria-Dev ")).toEqual({ login: "maria-dev" });
    expect(parseGithubLogin("octocat")).toEqual({ login: "octocat" });
    expect(parseGithubLogin("a".repeat(39))).toEqual({ login: "a".repeat(39) });
  });

  it("rejects what GitHub would reject, like the server", () => {
    for (const bad of ["-maria", "maria-", "ma--ria", "ma_ria", "a".repeat(40), "@@maria", "ma ria"]) {
      expect(parseGithubLogin(bad)).toEqual({ error: "That isn’t a valid GitHub username." });
    }
    expect(parseGithubLogin("  @ ")).toEqual({ error: "Enter a GitHub username." });
  });
});

describe("slugFromName", () => {
  it("makes a lowercase, hyphenated slug of letters and digits", () => {
    expect(slugFromName("Acme Mobile")).toBe("acme-mobile");
    expect(slugFromName("  Café & Más -- v2! ")).toBe("cafe-mas-v2");
    expect(slugFromName("")).toBe("");
  });

  it("stays within 50 characters without a trailing hyphen", () => {
    const slug = slugFromName(`${"a".repeat(49)} b`);
    expect(slug).toBe("a".repeat(49));
  });
});

describe("suggestTaskKeyPrefix", () => {
  it("uses the initials of a multi-word name, uppercased", () => {
    expect(suggestTaskKeyPrefix("Acme Mobile")).toBe("AM");
    expect(suggestTaskKeyPrefix("the big new thing")).toBe("TBNT");
  });

  it("uses the first letters of a one-word name and always starts with a letter", () => {
    expect(suggestTaskKeyPrefix("Landing")).toBe("LAN");
    expect(suggestTaskKeyPrefix("2024 report")).toBe("REP");
    expect(suggestTaskKeyPrefix("¡!")).toBe("");
  });
});

describe("validateProjectValues", () => {
  const valid = { name: "Shop", slug: "shop", taskKeyPrefix: "rf", discordChannelId: "" };

  it("accepts valid values, the Discord channel being optional", () => {
    expect(validateProjectValues(valid)).toEqual({});
    expect(validateProjectValues({ ...valid, discordChannelId: "12345678901234567" })).toEqual({});
  });

  it("explains each invalid field", () => {
    expect(
      validateProjectValues({ name: " ", slug: "Not a slug", taskKeyPrefix: "1X", discordChannelId: "123" }),
    ).toEqual({
      name: "Give the project a name.",
      slug: "Use lowercase letters, numbers and single hyphens (up to 50).",
      taskKeyPrefix: "Use 1–10 letters or numbers, starting with a letter.",
      discordChannelId: "A Discord channel ID is 17 to 20 digits.",
    });
  });
});

describe("toProjectInput", () => {
  it("trims, uppercases the prefix and sends a blank Discord channel as null", () => {
    expect(toProjectInput({ name: " Shop ", slug: " shop ", taskKeyPrefix: "rf", discordChannelId: " " })).toEqual({
      name: "Shop",
      slug: "shop",
      taskKeyPrefix: "RF",
      discordChannelId: null,
    });
  });
});

describe("parseRepositoryName", () => {
  it("accepts owner/repo", () => {
    expect(parseRepositoryName(" acme/shop.web ")).toEqual({ fullName: "acme/shop.web" });
  });

  it("rejects anything else", () => {
    for (const bad of ["acme", "acme/", "/shop", "acme/shop/x", "-acme/shop", "acme/sh op"]) {
      expect(parseRepositoryName(bad)).toEqual({ error: "Enter a repository as owner/repo." });
    }
  });
});

describe("formatAddedOn", () => {
  it("formats a timestamp as a short date", () => {
    expect(formatAddedOn("2026-10-09T15:00:00.000Z")).toBe("Oct 9, 2026");
  });
});

describe("parseApiTokenName", () => {
  it("accepts 1–60 characters, trimmed", () => {
    expect(parseApiTokenName("  VPS agent ")).toEqual({ name: "VPS agent" });
    expect(parseApiTokenName("x".repeat(60))).toEqual({ name: "x".repeat(60) });
  });

  it("rejects blank or too long names", () => {
    for (const bad of ["", "   ", "x".repeat(61)]) {
      expect(parseApiTokenName(bad)).toEqual({ error: "Give the token a name of up to 60 characters." });
    }
  });
});

describe("apiTokenDetails", () => {
  const token = {
    id: 1,
    name: "A",
    prefix: "abcdefgh",
    permission: "read" as const,
    createdAt: "2026-10-01T15:00:00.000Z",
    createdBy: "octocat",
    lastUsedAt: null,
    expiresAt: "2026-12-30T15:00:00.000Z",
    revokedAt: null,
    status: "active" as const,
  };

  it("describes creation, last use and expiry", () => {
    expect(apiTokenDetails(token)).toEqual(["Created Oct 1, 2026 by @octocat", "Never used", "Expires Dec 30, 2026"]);
  });

  it("covers deleted creators, used, expired, never-expiring and revoked tokens", () => {
    expect(
      apiTokenDetails({ ...token, createdBy: null, lastUsedAt: "2026-10-05T10:00:00.000Z", status: "expired" }),
    ).toEqual(["Created Oct 1, 2026", "Last used Oct 5, 2026", "Expired Dec 30, 2026"]);
    expect(
      apiTokenDetails({ ...token, expiresAt: null, revokedAt: "2026-10-06T10:00:00.000Z", status: "revoked" }),
    ).toEqual(["Created Oct 1, 2026 by @octocat", "Never used", "Never expires", "Revoked Oct 6, 2026"]);
  });
});

describe("apiTokenUsageHint", () => {
  it("reads the token from an environment variable, never inlining it", () => {
    expect(apiTokenUsageHint("https://tasks.example.com", "shop")).toBe(
      'curl -H "Authorization: Bearer $TRACKER_API_TOKEN" https://tasks.example.com/api/projects/shop/tasks',
    );
  });
});
