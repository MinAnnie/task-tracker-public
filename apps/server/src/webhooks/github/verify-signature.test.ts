import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyGithubSignature } from "./verify-signature.ts";

const secret = "It's a Secret to Everybody";
const body = "Hello, World!";
// Example from GitHub's "Validating webhook deliveries" documentation.
const githubDocsSignature =
  "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";

const sign = (payload: string, key = secret): string =>
  `sha256=${createHmac("sha256", key).update(payload).digest("hex")}`;

describe("verifyGithubSignature", () => {
  it("accepts the signature from GitHub's documentation example", () => {
    expect(verifyGithubSignature(secret, body, githubDocsSignature)).toBe(true);
  });

  it("accepts a valid signature of the raw body", () => {
    expect(verifyGithubSignature(secret, '{"a":1}', sign('{"a":1}'))).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(verifyGithubSignature(secret, body, undefined)).toBe(false);
  });

  it("rejects a signature made with another secret", () => {
    expect(verifyGithubSignature(secret, body, sign(body, "other"))).toBe(false);
  });

  it("rejects a signature of a different body", () => {
    expect(verifyGithubSignature(secret, `${body} `, githubDocsSignature)).toBe(false);
  });

  it("rejects a header without the sha256= prefix", () => {
    expect(verifyGithubSignature(secret, body, githubDocsSignature.slice("sha256=".length))).toBe(
      false,
    );
  });

  it("rejects a signature with the wrong length without throwing", () => {
    expect(verifyGithubSignature(secret, body, "sha256=abc")).toBe(false);
    expect(verifyGithubSignature(secret, body, `${githubDocsSignature}00`)).toBe(false);
  });

  it("rejects a non-hex signature of the right length", () => {
    expect(verifyGithubSignature(secret, body, `sha256=${"z".repeat(64)}`)).toBe(false);
  });

  it("rejects everything when the secret is empty", () => {
    expect(verifyGithubSignature("", body, sign(body, ""))).toBe(false);
  });
});
