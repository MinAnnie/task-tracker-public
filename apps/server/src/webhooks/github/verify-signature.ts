import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "sha256=";
const HEX_SHA256 = /^[0-9a-f]{64}$/i;

/**
 * Checks GitHub's `X-Hub-Signature-256` header against the raw request body.
 *
 * - The header must be `sha256=<hex>` where `<hex>` is the HMAC-SHA256 of the
 *   exact raw body bytes keyed with the webhook secret.
 * - Comparison is constant-time; malformed or wrong-length headers are rejected
 *   before comparing so `timingSafeEqual` never throws.
 * - An empty secret never verifies, to avoid accepting unsigned deliveries by mistake.
 */
export function verifyGithubSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | undefined,
): boolean {
  if (secret.length === 0 || signatureHeader === undefined) return false;
  if (!signatureHeader.startsWith(PREFIX)) return false;

  const received = signatureHeader.slice(PREFIX.length);
  if (!HEX_SHA256.test(received)) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  return timingSafeEqual(Buffer.from(received, "hex"), expected);
}
