// Verify a Shippo webhook signature.
//
// Shippo signs webhook deliveries with a per-account secret retrievable from
// goshippo.com → API → Webhooks. The header is:
//
//   Shippo-Auth-Signature: t=<unix-timestamp>,v1=<hex-hmac-sha256>
//
// where v1 = HMAC_SHA256(secret, `${t}.${rawBody}`). We require the
// timestamp to be within ±5min of now so a replayed body can't be re-played
// indefinitely. Verification is constant-time via timingSafeEqual.

import crypto from "node:crypto";

// 5-minute skew window. Generous enough that clock drift between Shippo's
// edge and ours won't cause false rejects, tight enough that a captured
// body can't be replayed days later.
const MAX_SKEW_SECONDS = 5 * 60;

export type SignatureResult = { ok: true } | { ok: false; reason: string };

export const parseSignatureHeader = (
  header: string | null,
): { t: number; v1: string } | null => {
  if (!header) return null;
  const parts = header.split(",").map((p) => p.trim());
  let t = 0;
  let v1 = "";
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "t") t = Number(v);
    else if (k === "v1") v1 = v;
  }
  if (!Number.isFinite(t) || t <= 0 || !v1) return null;
  return { t, v1 };
};

export const verifyShippoSignature = (opts: {
  rawBody: string;
  header: string | null;
  secret: string;
  now?: number;
}): SignatureResult => {
  const parsed = parseSignatureHeader(opts.header);
  if (!parsed) return { ok: false, reason: "missing_or_malformed_header" };
  const secret = opts.secret.trim();
  if (!secret) return { ok: false, reason: "no_secret_configured" };
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.t) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "stale_timestamp" };
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parsed.t}.${opts.rawBody}`)
    .digest("hex");
  // Constant-time compare. Buffers must be the same length or
  // timingSafeEqual throws — we guard ahead to avoid leaking a length
  // mismatch as a faster failure than a content mismatch.
  if (expected.length !== parsed.v1.length) {
    return { ok: false, reason: "signature_mismatch" };
  }
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parsed.v1, "hex");
  if (a.length !== b.length) return { ok: false, reason: "signature_mismatch" };
  try {
    if (!crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: "signature_mismatch" };
    }
  } catch {
    return { ok: false, reason: "signature_mismatch" };
  }
  return { ok: true };
};
