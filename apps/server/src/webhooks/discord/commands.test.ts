import { describe, expect, it } from "vitest";
import { DISCORD_COMMANDS } from "./commands.ts";

describe("DISCORD_COMMANDS", () => {
  it("defines the slash commands as guild chat-input commands", () => {
    expect(DISCORD_COMMANDS.map((c) => c.name)).toEqual(["tasks", "mine", "task", "take", "release"]);
    for (const command of DISCORD_COMMANDS) {
      expect(command.type).toBe(1);
      expect(command.contexts).toEqual([0]);
      expect(command.description.length).toBeGreaterThan(0);
      expect(command.description.length).toBeLessThanOrEqual(100);
      expect(command.name).toMatch(/^[a-z]{1,32}$/);
    }
  });

  it("gives every task command a required, autocompleted string `key` option", () => {
    const withKey = DISCORD_COMMANDS.filter((c) => ["task", "take", "release"].includes(c.name));
    for (const command of withKey) {
      expect(command.options).toEqual([
        { type: 3, name: "key", description: expect.any(String), required: true, autocomplete: true },
      ]);
    }
    const withoutKey = DISCORD_COMMANDS.filter((c) => ["tasks", "mine"].includes(c.name));
    for (const command of withoutKey) expect(command.options).toEqual([]);
  });
});
