// POST /api/stripe-connect/webhook
//
// Stripe Connect platform webhook. Listens for account-state changes
// so the stylist's UI doesn't have to poll constantly:
//   • account.updated                   → mirror charges/payouts/details
//                                         flags into profiles
//   • account.application.deauthorized  → mark profile as `disabled`
//
// Signature verified manually (same HMAC-SHA256 algorithm as the
// deposit webhook). Set STRIPE_CONNECT_WEBHOOK_SECRET in env and
// register the endpoint with these two events in the Stripe dashboard
// (under "Listen to events on Connected accounts").

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOLERANCE_SECONDS = 5 * 60;

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

const verifySignature = (
  rawBody: string,
  header: string | null,
  secret: string,
): { ok: true } | { ok: false; reason: string } => {
  if (!header) return { ok: false, reason: "missing signature header" };
  const parts = header.split(",").map(p => p.trim());
  let ts: number | null = null;
  const v1: string[] = [];
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (k === "t" && v) ts = Number(v);
    else if (k === "v1" && v) v1.push(v);
  }
  if (!ts || v1.length === 0) return { ok: false, reason: "malformed signature header" };
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "signature timestamp out of tolerance" };
  }
  const payload = `${ts}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  for (const candidate of v1) {
    let candidateBuf: Buffer;
    try { candidateBuf = Buffer.from(candidate, "hex"); }
    catch { continue; }
    if (candidateBuf.length === expectedBuf.length && timingSafeEqual(candidateBuf, expectedBuf)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "no signature match" };
};

export async function POST(req: Request) {
  let secret: string;
  let supabaseUrl: string;
  let serviceKey: string;
  try {
    secret = env("STRIPE_CONNECT_WEBHOOK_SECRET");
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "not configured" }, { status: 500 });
  }

  const rawBody = await req.text();
  const verify = verifySignature(rawBody, req.headers.get("stripe-signature"), secret);
  if (!verify.ok) {
    return NextResponse.json({ error: verify.reason }, { status: 400 });
  }

  let evt: any;
  try { evt = JSON.parse(rawBody); }
  catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // For Connect events, `account` is the connected acct id. For
  // platform events, the object id is the account directly.
  const eventType: string = evt?.type || "";
  const account = evt?.data?.object;

  if (eventType === "account.updated") {
    const accountId: string | undefined = account?.id;
    if (!accountId) {
      return NextResponse.json({ received: true, ignored: "no_account_id" }, { status: 200 });
    }
    const { error: rpcErr } = await admin.rpc("apply_stripe_connect_account_update", {
      account_id_in: accountId,
      charges_enabled_in: !!account?.charges_enabled,
      payouts_enabled_in: !!account?.payouts_enabled,
      details_submitted_in: !!account?.details_submitted,
      deauthorized_in: false,
    });
    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }
    return NextResponse.json({ received: true }, { status: 200 });
  }

  if (eventType === "account.application.deauthorized") {
    const accountId: string | undefined = evt?.account || account?.id;
    if (!accountId) {
      return NextResponse.json({ received: true, ignored: "no_account_id" }, { status: 200 });
    }
    const { error: rpcErr } = await admin.rpc("apply_stripe_connect_account_update", {
      account_id_in: accountId,
      charges_enabled_in: false,
      payouts_enabled_in: false,
      details_submitted_in: false,
      deauthorized_in: true,
    });
    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // Other Connect events (capability.updated, etc.) — ack and ignore.
  return NextResponse.json({ received: true, ignored: eventType }, { status: 200 });
}
