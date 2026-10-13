import { describe, expect, it } from "vitest";
import { readConfig } from "./config.ts";

describe("readConfig", () => {
  it("has no URL and no project by default", () => {
    expect(readConfig({ TRACKER_API_TOKEN: "ttk_x" })).toEqual({
      token: "ttk_x",
      apiUrl: undefined,
      project: undefined,
    });
  });

  it("reads the URL and default project, trimming blanks and trailing slashes", () => {
    expect(
      readConfig({
        TRACKER_API_TOKEN: " ttk_x ",
        TRACKER_API_URL: " https://your-tracker.example.com/ ",
        TRACKER_PROJECT: " Rf ",
      }),
    ).toEqual({ token: "ttk_x", apiUrl: "https://your-tracker.example.com", project: "rf" });
  });

  it("treats a missing or blank token or URL as absent", () => {
    expect(readConfig({}).token).toBeUndefined();
    expect(readConfig({ TRACKER_API_TOKEN: "  " }).token).toBeUndefined();
    expect(readConfig({ TRACKER_API_URL: "", TRACKER_PROJECT: "" })).toEqual({
      token: undefined,
      apiUrl: undefined,
      project: undefined,
    });
    expect(readConfig({ TRACKER_API_URL: " / " }).apiUrl).toBeUndefined();
  });

  it("treats an unexpanded ${VAR} placeholder (a config referencing an unset variable) as absent", () => {
    expect(readConfig({ TRACKER_API_TOKEN: "${TRACKER_API_TOKEN}" }).token).toBeUndefined();
    expect(readConfig({ TRACKER_PROJECT: "${TRACKER_PROJECT}" }).project).toBeUndefined();
    expect(readConfig({ TRACKER_API_URL: "${TRACKER_API_URL}" }).apiUrl).toBeUndefined();
  });
});
