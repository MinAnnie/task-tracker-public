import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyDiscordSignature } from "./verify-signature.ts";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
// The raw 32-byte key is the tail of the SPKI DER encoding; Discord shows it as hex.
const publicKeyHex = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
const other = generateKeyPairSync("ed25519");

const signWith = (key: typeof privateKey, timestamp: string, body: string) =>
  sign(null, Buffer.from(timestamp + body), key).toString("hex");

describe("verifyDiscordSignature", () => {
  const timestamp = "1700000000";
  const body = JSON.stringify({ type: 1 });

  it("accepts an Ed25519 signature over timestamp + raw body", () => {
    expect(verifyDiscordSignature(publicKeyHex, body, signWith(privateKey, timestamp, body), timestamp)).toBe(true);
  });

  it("rejects a signature made with another key", () => {
    const signature = signWith(other.privateKey, timestamp, body);
    expect(verifyDiscordSignature(publicKeyHex, body, signature, timestamp)).toBe(false);
  });

  it("rejects a tampered body or timestamp", () => {
    const signature = signWith(privateKey, timestamp, body);
    expect(verifyDiscordSignature(publicKeyHex, `${body} `, signature, timestamp)).toBe(false);
    expect(verifyDiscordSignature(publicKeyHex, body, signature, "1700000001")).toBe(false);
  });

  it("rejects missing or malformed headers without throwing", () => {
    const signature = signWith(privateKey, timestamp, body);
    expect(verifyDiscordSignature(publicKeyHex, body, undefined, timestamp)).toBe(false);
    expect(verifyDiscordSignature(publicKeyHex, body, signature, undefined)).toBe(false);
    expect(verifyDiscordSignature(publicKeyHex, body, "", timestamp)).toBe(false);
    expect(verifyDiscordSignature(publicKeyHex, body, "zz".repeat(64), timestamp)).toBe(false);
    expect(verifyDiscordSignature(publicKeyHex, body, signature.slice(2), timestamp)).toBe(false);
  });

  it("rejects everything when the public key is malformed", () => {
    const signature = signWith(privateKey, timestamp, body);
    expect(verifyDiscordSignature("", body, signature, timestamp)).toBe(false);
    expect(verifyDiscordSignature("abc", body, signature, timestamp)).toBe(false);
  });
});
