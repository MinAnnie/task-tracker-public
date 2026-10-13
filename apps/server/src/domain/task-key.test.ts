import { describe, expect, it } from "vitest";
import { compareTaskKeys, formatTaskKey, nextTaskKeyNumber, taskKeyNumber } from "./task-key.ts";

describe("formatTaskKey", () => {
  it("joins prefix and number with a hyphen", () => {
    expect(formatTaskKey("RF", 14)).toBe("RF-14");
  });
});

describe("nextTaskKeyNumber", () => {
  it("uses the stored counter when no key is ahead of it", () => {
    expect(nextTaskKeyNumber("RF", 1, [])).toBe(1);
    expect(nextTaskKeyNumber("RF", 5, ["RF-1", "RF-4"])).toBe(5);
  });

  it("skips past the highest numeric suffix of keys with this prefix", () => {
    expect(nextTaskKeyNumber("RF", 1, ["RF-1", "RF-9", "RF-3"])).toBe(10);
  });

  it("matches the prefix case-insensitively, so no key differs from a generated one only by case", () => {
    expect(nextTaskKeyNumber("RF", 1, ["rf-7"])).toBe(8);
  });

  it("counts suffixes with leading zeros by their value", () => {
    expect(nextTaskKeyNumber("RF", 1, ["RF-007"])).toBe(8);
  });

  it.each([["RF-04-1"], ["RF-"], ["RF-x"], ["XRF-50"], ["RFA-50"], ["RF 50"], ["RF-5a"], ["RF-5B"], ["BL-50"]])(
    "ignores the key %j, which is not <PREFIX>-<digits>",
    (key) => {
      expect(nextTaskKeyNumber("RF", 2, [key])).toBe(2);
    },
  );

  it("ignores suffixes too large for the stored counter", () => {
    expect(nextTaskKeyNumber("RF", 3, ["RF-2147483646", "RF-99999999999999999999"])).toBe(3);
    expect(nextTaskKeyNumber("RF", 3, ["RF-2147483645"])).toBe(2147483646);
  });
});

describe("taskKeyNumber", () => {
  it.each([
    ["RF-14", 14],
    ["rf-007", 7],
    ["IMPORTED-2", 2],
    ["RF-04-1", 1],
  ])("reads the trailing number of %j", (key, expected) => {
    expect(taskKeyNumber(key)).toBe(expected);
  });

  it.each([["RF"], ["RF-"], ["legacy"], ["RF-1a"]])("is undefined for %j", (key) => {
    expect(taskKeyNumber(key)).toBeUndefined();
  });
});

describe("compareTaskKeys", () => {
  it("orders by trailing number, then keys without a number by text", () => {
    const keys = ["RF-10", "legacy-b", "RF-2", "legacy-a", "RF-1"];
    expect([...keys].sort(compareTaskKeys)).toEqual(["RF-1", "RF-2", "RF-10", "legacy-a", "legacy-b"]);
  });

  it("orders a key with a letter suffix right after the key without it", () => {
    const keys = ["AUTH-09", "AUTH-08B", "legacy", "AUTH-08", "AUTH-10"];
    expect([...keys].sort(compareTaskKeys)).toEqual(["AUTH-08", "AUTH-08B", "AUTH-09", "AUTH-10", "legacy"]);
  });

  it("breaks ties on equal numbers by text", () => {
    expect(["RF-02", "AB-2"].sort(compareTaskKeys)).toEqual(["AB-2", "RF-02"]);
  });
});
