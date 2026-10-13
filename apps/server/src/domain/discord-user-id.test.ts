import { describe, expect, it } from "vitest";
import { isDiscordUserId } from "./discord-user-id.ts";

describe("isDiscordUserId", () => {
  it.each(["12345678901234567", "123456789012345678", "12345678901234567890"])("accepts the snowflake %s", (id) => {
    expect(isDiscordUserId(id)).toBe(true);
  });

  it.each([
    null,
    undefined,
    42,
    "",
    "1234567890123456",
    "123456789012345678901",
    "12345678901234567a",
    " 123456789012345678",
    "123456789012345678\n",
    "<@123456789012345678>",
    "everyone",
    "١٢٣٤٥٦٧٨٩٠١٢٣٤٥٦٧٨",
  ])("rejects %j", (value) => {
    expect(isDiscordUserId(value)).toBe(false);
  });
});
