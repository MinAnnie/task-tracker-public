import { describe, expect, it } from "vitest";
import { resolveDependencyInput } from "./dependency-input.ts";

const suggestions = [
  { key: "RF-38", title: "Mapa interactivo con estado en tiempo real" },
  { key: "AUTH-08B", title: "Login en apps/web (parte 2: sesión del socio)" },
  { key: "AUTH-08", title: "Login en apps/web (parte 1: sesión del conductor)" },
];

describe("resolveDependencyInput", () => {
  it("keeps a typed key as typed, trimmed (the server matches keys case-insensitively)", () => {
    expect(resolveDependencyInput(" rf-38 ", suggestions)).toEqual({ ok: true, key: "rf-38" });
    expect(resolveDependencyInput("AUTH-08B", suggestions)).toEqual({ ok: true, key: "AUTH-08B" });
  });

  it("sends key-shaped text it doesn't know to the server, which has the final word", () => {
    expect(resolveDependencyInput("RF-99", suggestions)).toEqual({ ok: true, key: "RF-99" });
  });

  it("resolves a title search to the one task whose title contains it", () => {
    expect(resolveDependencyInput("mapa", suggestions)).toEqual({ ok: true, key: "RF-38" });
    expect(resolveDependencyInput("parte 2", suggestions)).toEqual({ ok: true, key: "AUTH-08B" });
  });

  it("resolves a suggestion's full label, 'KEY title'", () => {
    expect(resolveDependencyInput("RF-38 Mapa interactivo con estado en tiempo real", suggestions)).toEqual({
      ok: true,
      key: "RF-38",
    });
  });

  it("refuses a title search that matches several tasks or none", () => {
    expect(resolveDependencyInput("login en apps", suggestions)).toEqual({ ok: false, reason: "ambiguous" });
    expect(resolveDependencyInput("wallet", suggestions)).toEqual({ ok: false, reason: "no_match" });
  });

  it("refuses empty text", () => {
    expect(resolveDependencyInput("   ", suggestions)).toEqual({ ok: false, reason: "empty" });
  });
});
