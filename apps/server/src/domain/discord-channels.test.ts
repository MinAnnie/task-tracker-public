import { describe, expect, it } from "vitest";
import { selectableDiscordChannels } from "./discord-channels.ts";

describe("selectableDiscordChannels", () => {
  it("keeps text (0) and announcement (5) channels, sorted by position", () => {
    expect(
      selectableDiscordChannels([
        { id: "3", name: "news", type: 5, position: 2 },
        { id: "1", name: "voice", type: 2, position: 0 },
        { id: "2", name: "general", type: 0, position: 1 },
        { id: "4", name: "Category", type: 4, position: 0 },
        { id: "5", name: "forum", type: 15, position: 3 },
        { id: "6", name: "dev", type: 0, position: 0 },
      ]),
    ).toEqual([
      { id: "6", name: "dev", type: 0, position: 0 },
      { id: "2", name: "general", type: 0, position: 1 },
      { id: "3", name: "news", type: 5, position: 2 },
    ]);
  });

  it("breaks position ties by name so the order is stable", () => {
    expect(
      selectableDiscordChannels([
        { id: "2", name: "b", type: 0, position: 1 },
        { id: "1", name: "a", type: 0, position: 1 },
      ]).map((channel) => channel.name),
    ).toEqual(["a", "b"]);
  });
});
