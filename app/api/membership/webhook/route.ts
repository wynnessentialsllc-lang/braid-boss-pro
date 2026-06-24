// Stripe Connect webhook for membership subscriptions.
//
// Configure ONE Connect webhook endpoint in Stripe pointing here, with
// STRIPE_MEMBERSHIP_WEBHOOK_SECRET, subscribed to:
//   checkout.session.completed        (subscription mode → create record)
//   invoice.paid                      (each paid cycle → grant visits/credit)
//   invoice.payment_failed            (card declined → mark past_due)
//   customer.subscription.deleted     (ended → mark canceled)
//   customer.subscription.updated     (status / period changes)
//
// Each paid cycle tops up a single rolling client_packages row (created
// on first payment), so the chair-side redeem flow is unchanged. Grants
// are idempotent per Stripe invoice via membership_invoices, and the
// whole event is idempotent via record_stripe_webhook_event.
//
// Signature verification is the same manual HMAC the deposit webhook uses.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_VERSION = "2024-06-20";
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

const isoFromUnix = (s: unknown): string | null => {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
};

const mapStatus = (stripeStatus: string | undefined): "active" | "past_due" | "canceled" | "incomplete" => {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "incomplete";
  }
};

// Fetch a subscription on the connected account (for status, period end,
// and the template/buyer metadata we stamped at checkout).
const fetchSubscription = async (subId: string, acctId: string, secret: string): Promise<any | null> => {
  try {
    const res = await fetch(`${STRIPE_API}/subscriptions/${subId}`, {
      headers: { Authorization: `Bearer ${secret}`, "Stripe-Version": STRIPE_VERSION, "Stripe-Account": acctId },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
};

// Find-or-create the membership row for a subscription. Tolerant of event
// ordering: invoice.paid can land before checkout.session.completed.
const ensureMembership = async (
  admin: any,
  sub: any,
): Promise<any | null> => {
  const subId: string | undefined = typeof sub?.id === "string" ? sub.id : undefined;
  if (!subId) return null;
  const { data: existing } = await admin
    .from("client_memberships").select("*").eq("stripe_subscription_id", subId).maybeSingle();
  if (existing) return existing;

  const meta = sub?.metadata || {};
  const templateId: string | undefined = meta.membership_template_id;
  if (!templateId) return null;
  const { data: tpl } = await admin
    .from("package_templates")
    .select("id, user_id, name, kind, visits, credit_amount, price, billing_interval")
    .eq("id", templateId)
    .maybeSingle();
  if (!tpl) return null;

  const isVisits = tpl.kind === "visits";
  const row = {
    user_id: tpl.user_id,
    client_id: null,
    client_name: meta.buyer_name || null,
    template_id: tpl.id,
    name: tpl.name,
    kind: tpl.kind,
    per_cycle_visits: isVisits ? Math.max(1, Number(tpl.visits) || 1) : null,
    per_cycle_credit: !isVisits ? Math.max(0, Number(tpl.credit_amount) || 0) : null,
    price: Number(tpl.price) || 0,
    billing_interval: tpl.billing_interval || "month",
    stripe_connect_account_id: typeof sub?.account === "string" ? sub.account : (sub?.__acct || null),
    stripe_customer_id: typeof sub?.customer === "string" ? sub.customer : null,
    stripe_subscription_id: subId,
    status: mapStatus(sub?.status),
    current_period_end: isoFromUnix(sub?.current_period_end),
    purchaser_name: meta.buyer_name || null,
    purchaser_email: meta.buyer_email || null,
    started_at: new Date().toISOString(),
  };
  const { data: created, error } = await admin
    .from("client_memberships").insert(row).select("*").single();
  if (error) {
    // A racing event may have created it first — re-read.
    const { data: again } = await admin
      .from("client_memberships").select("*").eq("stripe_subscription_id", subId).maybeSingle();
    return again || null;
  }
  // Bell so the stylist can assign the new member to a client.
  try {
    await admin.from("notifications").insert({
      id: `membership:${subId}`,
      user_id: tpl.user_id,
      category: "membership",
      title: "New member joined",
      body: `${row.purchaser_name || row.purchaser_email || "Someone"} subscribed to "${tpl.name}". Assign it to a client.`,
      data: { templateId: tpl.id, membershipId: created?.id },
    });
  } catch { /* bell is best-effort */ }
  return created;
};

// Top up (or create) the rolling package this membership feeds. Idempotent
// per invoice: the membership_invoices unique(stripe_invoice_id) gate means
// a Stripe retry can't double-credit.
const grantCycle = async (
  admin: any,
  membership: any,
  invoiceId: string,
  amountPaid: number,
): Promise<void> => {
  const isVisits = membership.kind === "visits";
  const addVisits = isVisits ? Math.max(0, Number(membership.per_cycle_visits) || 0) : 0;
  const addCredit = !isVisits ? Math.max(0, Number(membership.per_cycle_credit) || 0) : 0;

  // Idempotency gate — claim this invoice first.
  const { error: claimErr } = await admin.from("membership_invoices").insert({
    user_id: membership.user_id,
    membership_id: membership.id,
    stripe_invoice_id: invoiceId,
    amount: amountPaid,
    visits_granted: addVisits,
    credit_granted: addCredit,
  });
  if (claimErr) {
    // Unique violation → already granted for this invoice; nothing to do.
    return;
  }

  let packageId: string | null = membership.package_id || null;
  if (packageId) {
    // Top up the existing rolling package and reactivate if depleted.
    const { data: pkg } = await admin
      .from("client_packages").select("*").eq("id", packageId).maybeSingle();
    if (pkg) {
      const patch: Record<string, unknown> = { status: "active" };
      if (isVisits) {
        patch.total_visits = (Number(pkg.total_visits) || 0) + addVisits;
        patch.remaining_visits = (Number(pkg.remaining_visits) || 0) + addVisits;
      } else {
        patch.initial_amount = (Number(pkg.initial_amount) || 0) + addCredit;
        patch.balance = (Number(pkg.balance) || 0) + addCredit;
      }
      await admin.from("client_packages").update(patch).eq("id", packageId);
      return;
    }
    // Package row vanished — fall through and create a fresh one.
    packageId = null;
  }

  // First cycle: mint the rolling package and link it to the membership.
  const { data: created } = await admin.from("client_packages").insert({
    user_id: membership.user_id,
    client_id: membership.client_id,
    client_name: membership.client_name,
    template_id: membership.template_id,
    name: membership.name,
    kind: membership.kind,
    total_visits: isVisits ? addVisits : null,
    remaining_visits: isVisits ? addVisits : null,
    initial_amount: !isVisits ? addCredit : null,
    balance: !isVisits ? addCredit : null,
    price: 0,
    status: "active",
    source: "online",
    purchaser_name: membership.purchaser_name,
    purchaser_email: membership.purchaser_email,
    membership_id: membership.id,
  }).select("id").single();
  if (created?.id) {
    await admin.from("client_memberships").update({ package_id: created.id }).eq("id", membership.id);
  }
};

export async function POST(req: Request) {
  let secret: string;
  let supabaseUrl: string;
  let serviceKey: string;
  let stripeSecret: string;
  try {
    secret = env("STRIPE_MEMBERSHIP_WEBHOOK_SECRET");
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env("SUPABASE_URL");
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    stripeSecret = env("STRIPE_SECRET_KEY");
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "not configured" }, { status: 500 });
  }

  const rawBody = await req.text();
  const verify = verifySignature(rawBody, req.headers.get("stripe-signature"), secret);
  if (!verify.ok) return NextResponse.json({ error: verify.reason }, { status: 400 });

  let evt: any;
  try { evt = JSON.parse(rawBody); }
  catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const type: string = evt?.type || "";
  const acctId: string | null = typeof evt?.account === "string" ? evt.account : null;
  const HANDLED = new Set([
    "checkout.session.completed",
    "invoice.paid",
    "invoice.payment_failed",
    "customer.subscription.deleted",
    "customer.subscription.updated",
  ]);
  if (!HANDLED.has(type)) {
    return NextResponse.json({ received: true, ignored: type }, { status: 200 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Event-level idempotency claim.
  const eventId: string | undefined = typeof evt?.id === "string" ? evt.id : undefined;
  if (eventId) {
    const { data: firstTime, error: dedupeErr } = await admin.rpc("record_stripe_webhook_event", {
      event_id_in: eventId,
      event_type_in: type,
      endpoint_in: "membership",
      account_id_in: acctId,
    });
    if (dedupeErr) return NextResponse.json({ error: dedupeErr.message }, { status: 500 });
    if (firstTime === false) {
      return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
    }
  }

  const obj = evt?.data?.object || {};

  try {
    if (type === "checkout.session.completed") {
      // Only subscription-mode sessions that carry our membership metadata.
      if (obj?.mode !== "subscription" || !obj?.metadata?.membership_template_id) {
        return NextResponse.json({ received: true, ignored: "not_membership_session" }, { status: 200 });
      }
      const subId = typeof obj?.subscription === "string" ? obj.subscription : null;
      if (!subId || !acctId) {
        return NextResponse.json({ received: true, ignored: "missing_subscription" }, { status: 200 });
      }
      const sub = await fetchSubscription(subId, acctId, stripeSecret);
      if (!sub) return NextResponse.json({ error: "could not load subscription" }, { status: 500 });
      sub.__acct = acctId;
      // Prefer the session's metadata (has buyer name/email) if the
      // subscription metadata is sparse.
      sub.metadata = { ...(sub.metadata || {}), ...(obj.metadata || {}) };
      if (typeof sub.customer !== "string" && typeof obj.customer === "string") sub.customer = obj.customer;
      await ensureMembership(admin, sub);
      return NextResponse.json({ received: true, membership: true }, { status: 200 });
    }

    if (type === "invoice.paid") {
      const subId = typeof obj?.subscription === "string" ? obj.subscription : null;
      const invoiceId = typeof obj?.id === "string" ? obj.id : null;
      if (!subId || !invoiceId || !acctId) {
        return NextResponse.json({ received: true, ignored: "missing_invoice_fields" }, { status: 200 });
      }
      const sub = await fetchSubscription(subId, acctId, stripeSecret);
      if (!sub) return NextResponse.json({ error: "could not load subscription" }, { status: 500 });
      sub.__acct = acctId;
      const membership = await ensureMembership(admin, sub);
      if (!membership) {
        return NextResponse.json({ received: true, ignored: "no_membership" }, { status: 200 });
      }
      const amountPaid = typeof obj?.amount_paid === "number" ? obj.amount_paid / 100 : 0;
      await grantCycle(admin, membership, invoiceId, amountPaid);
      // Keep status + renewal date current.
      await admin.from("client_memberships").update({
        status: mapStatus(sub?.status),
        current_period_end: isoFromUnix(sub?.current_period_end),
      }).eq("id", membership.id);
      return NextResponse.json({ received: true, granted: true }, { status: 200 });
    }

    if (type === "invoice.payment_failed") {
      const subId = typeof obj?.subscription === "string" ? obj.subscription : null;
      if (!subId) return NextResponse.json({ received: true, ignored: "no_sub" }, { status: 200 });
      const { data: m } = await admin
        .from("client_memberships").select("id, user_id, name, client_name")
        .eq("stripe_subscription_id", subId).maybeSingle();
      if (m) {
        await admin.from("client_memberships").update({ status: "past_due" }).eq("id", m.id);
        try {
          await admin.from("notifications").insert({
            id: `membership_pastdue:${subId}:${typeof obj?.id === "string" ? obj.id : ""}`,
            user_id: m.user_id,
            category: "membership",
            title: "Membership payment failed",
            body: `${m.client_name || "A member"}'s card was declined for "${m.name}". They may need to update it.`,
            data: { membershipId: m.id },
          });
        } catch { /* best-effort */ }
      }
      return NextResponse.json({ received: true, past_due: true }, { status: 200 });
    }

    if (type === "customer.subscription.deleted" || type === "customer.subscription.updated") {
      const subId = typeof obj?.id === "string" ? obj.id : null;
      if (!subId) return NextResponse.json({ received: true, ignored: "no_sub" }, { status: 200 });
      const status = type === "customer.subscription.deleted" ? "canceled" : mapStatus(obj?.status);
      const patch: Record<string, unknown> = {
        status,
        current_period_end: isoFromUnix(obj?.current_period_end),
      };
      if (status === "canceled") patch.canceled_at = new Date().toISOString();
      await admin.from("client_memberships").update(patch).eq("stripe_subscription_id", subId);
      return NextResponse.json({ received: true, updated: true }, { status: 200 });
    }
  } catch (e) {
    console.error("[membership/webhook] handler failed:", e);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
