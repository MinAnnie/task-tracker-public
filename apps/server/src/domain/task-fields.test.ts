import { describe, expect, it } from "vitest";
import {
  normalizeTaskDescription,
  normalizeTaskPriority,
  normalizeTaskStage,
  normalizeTaskStatus,
  normalizeTaskTitle,
} from "./task-fields.ts";

const NON_STRINGS = [undefined, 42, {}, ["x"], true];

describe("normalizeTaskTitle", () => {
  it.each([
    ["Checkout", "Checkout"],
    ["  Add checkout  ", "Add checkout"],
    ["x".repeat(200), "x".repeat(200)],
    [` ${"x".repeat(200)} `, "x".repeat(200)],
  ])("accepts %j as %j", (input, expected) => {
    expect(normalizeTaskTitle(input)).toBe(expected);
  });

  it.each([[""], ["   "], ["x".repeat(201)]])("rejects %j", (input) => {
    expect(normalizeTaskTitle(input)).toBeUndefined();
  });

  it("rejects non-string values and null", () => {
    for (const value of [...NON_STRINGS, null]) expect(normalizeTaskTitle(value)).toBeUndefined();
  });
});

describe("normalizeTaskDescription", () => {
  it.each([
    ["Some *markdown*", "Some *markdown*"],
    ["  keeps inner\n  whitespace\n", "  keeps inner\n  whitespace\n"],
    ["x".repeat(10_000), "x".repeat(10_000)],
  ])("accepts %j as is", (input, expected) => {
    expect(normalizeTaskDescription(input)).toBe(expected);
  });

  it.each([[null], [""], ["  \n "]])("maps %j to null (no description)", (input) => {
    expect(normalizeTaskDescription(input)).toBeNull();
  });

  it("rejects descriptions over 10000 characters", () => {
    expect(normalizeTaskDescription("x".repeat(10_001))).toBeUndefined();
  });

  it("rejects non-string values", () => {
    for (const value of NON_STRINGS) expect(normalizeTaskDescription(value)).toBeUndefined();
  });
});

describe("normalizeTaskStage", () => {
  it.each([
    ["Backend", "Backend"],
    ["  QA  ", "QA"],
    ["x".repeat(50), "x".repeat(50)],
    [` ${"x".repeat(50)} `, "x".repeat(50)],
  ])("accepts %j as %j", (input, expected) => {
    expect(normalizeTaskStage(input)).toBe(expected);
  });

  it.each([[null], [""], ["   "]])("maps %j to null (no stage)", (input) => {
    expect(normalizeTaskStage(input)).toBeNull();
  });

  it("rejects stages over 50 characters", () => {
    expect(normalizeTaskStage("x".repeat(51))).toBeUndefined();
  });

  it("rejects non-string values", () => {
    for (const value of NON_STRINGS) expect(normalizeTaskStage(value)).toBeUndefined();
  });
});

describe("normalizeTaskPriority", () => {
  it.each([["urgent"], ["high"], ["medium"], ["low"]])("accepts %j", (input) => {
    expect(normalizeTaskPriority(input)).toBe(input);
  });

  it.each([["URGENT"], ["critical"], [""], [null], [1]])("rejects %j", (input) => {
    expect(normalizeTaskPriority(input)).toBeUndefined();
  });
});

describe("normalizeTaskStatus", () => {
  it.each([["todo"], ["in_progress"], ["in_review"], ["done"], ["blocked"]])("accepts %j", (input) => {
    expect(normalizeTaskStatus(input)).toBe(input);
  });

  it.each([["DONE"], ["closed"], [""], [null], [1]])("rejects %j", (input) => {
    expect(normalizeTaskStatus(input)).toBeUndefined();
  });
});
