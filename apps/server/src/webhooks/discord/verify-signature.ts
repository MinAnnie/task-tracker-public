import { createPublicKey, verify, type KeyObject } from "node:crypto";

/** DER prefix turning a raw 32-byte Ed25519 public key into an SPKI structure. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const HEX_PUBLIC_KEY = /^[0-9a-f]{64}$/i;
const HEX_SIGNATURE = /^[0-9a-f]{128}$/i;

/** Whether `value` is a Discord application public key: 32 bytes as 64 hex characters. */
export function isDiscordPublicKey(value: string): boolean {
  return HEX_PUBLIC_KEY.test(value);
}

const keys = new Map<string, KeyObject>();

function publicKeyObject(publicKeyHex: string): KeyObject {
  let key = keys.get(publicKeyHex);
  if (key === undefined) {
    const der = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]);
    key = createPublicKey({ key: der, format: "der", type: "spki" });
    keys.set(publicKeyHex, key);
  }
  return key;
}

/**
 * Checks a Discord interaction request: `X-Signature-Ed25519` must be the hex
 * Ed25519 signature of `X-Signature-Timestamp` followed by the exact raw body,
 * made with the application's key. Missing or malformed values never verify and
 * never throw.
 */
export function verifyDiscordSignature(
  publicKeyHex: string,
  rawBody: string,
  signatureHeader: string | undefined,
  timestampHeader: string | undefined,
): boolean {
  if (!isDiscordPublicKey(publicKeyHex)) return false;
  if (signatureHeader === undefined || !HEX_SIGNATURE.test(signatureHeader)) return false;
  if (!timestampHeader) return false;
  try {
    return verify(
      null,
      Buffer.from(timestampHeader + rawBody, "utf8"),
      publicKeyObject(publicKeyHex),
      Buffer.from(signatureHeader, "hex"),
    );
  } catch {
    return false;
  }
}
