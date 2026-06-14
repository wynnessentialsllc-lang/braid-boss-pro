import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { parseSignatureHeader, verifyShippoSignature } from "./shippo-signature";

const sign = (secret: string, t: number, body: string) =>
  crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");

const header = (t: number, v1: string) => `t=${t},v1=${v1}`;

describe("parseSignatureHeader", () => {
  it("returns null for null / empty / malformed", () => {
    expect(parseSignatureHeader(null)).toBeNull();
    expect(parseSignatureHeader("")).toBeNull();
    expect(parseSignatureHeader("garbage")).toBeNull();
    expect(parseSignatureHeader("t=,v1=")).toBeNull();
  });

  it("parses well-formed headers", () => {
    expect(parseSignatureHeader("t=1700000000,v1=abc123")).toEqual({
      t: 1700000000,
      v1: "abc123",
    });
  });

  it("ignores unknown keys + whitespace", () => {
    expect(parseSignatureHeader(" t=42 , v1=xx , v2=yy ")).toEqual({ t: 42, v1: "xx" });
  });
});

describe("verifyShippoSignature", () => {
  const secret = "test-secret-32-bytes-long-or-so";
  const body = JSON.stringify({ event: "track_updated", data: { tracking_number: "abc" } });
  const t = 1700000000;
  const validSig = sign(secret, t, body);

  it("rejects when header is missing", () => {
    const r = verifyShippoSignature({ rawBody: body, header: null, secret, now: t });
    expect(r).toEqual({ ok: false, reason: "missing_or_malformed_header" });
  });

  it("rejects when no secret is configured", () => {
    const r = verifyShippoSignature({ rawBody: body, header: header(t, validSig), secret: "", now: t });
    expect(r).toEqual({ ok: false, reason: "no_secret_configured" });
  });

  it("rejects a stale timestamp (>5 min off)", () => {
    const r = verifyShippoSignature({
      rawBody: body,
      header: header(t, validSig),
      secret,
      now: t + 6 * 60,
    });
    expect(r).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("accepts a valid signature within the skew window", () => {
    const r = verifyShippoSignature({
      rawBody: body,
      header: header(t, validSig),
      secret,
      now: t + 60,
    });
    expect(r).toEqual({ ok: true });
  });

  it("rejects a tampered body", () => {
    const r = verifyShippoSignature({
      rawBody: body + " ",
      header: header(t, validSig),
      secret,
      now: t,
    });
    expect(r).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects a forged signature with the right length", () => {
    const fake = "0".repeat(validSig.length);
    const r = verifyShippoSignature({
      rawBody: body,
      header: header(t, fake),
      secret,
      now: t,
    });
    expect(r).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects when the signature is signed with the wrong secret", () => {
    const r = verifyShippoSignature({
      rawBody: body,
      header: header(t, sign("wrong-secret", t, body)),
      secret,
      now: t,
    });
    expect(r).toEqual({ ok: false, reason: "signature_mismatch" });
  });
});
