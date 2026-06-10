"use client";

// Tap to Pay on iPhone — JS orchestration for the in-app card flow.
//
// The app's web bundle runs inside the Capacitor iOS shell, so we reach
// the native Tap to Pay plugin through the `window.Capacitor` global that
// Capacitor injects at runtime — exactly like lib/platform.ts does for
// isNativePlatform(). We deliberately do NOT import @capacitor/core here,
// keeping it out of the web/PWA bundle.
//
// The native plugin (ios/.../TapToPayPlugin.swift, registered as
// "TapToPay") wraps the Stripe Terminal SDK. It is only present in a
// native build that has had the plugin added + `cap sync` run; until then
// getPlugin() returns null and the UI falls back to the manual flow, so
// shipping this file to the web is always safe.

import { getSupabase } from "./supabase";

// Native plugin surface. Kept tiny: JS hands the SDK everything it needs
// (a connection token, a Terminal location, and the PaymentIntent client
// secret) and the plugin drives the on-device reader UI.
type TapToPayPlugin = {
  isSupported(): Promise<{ supported: boolean; reason?: string }>;
  collectPayment(opts: {
    connectionToken: string;
    locationId: string;
    clientSecret: string;
    amountLabel?: string;
  }): Promise<{ status: string; paymentIntentId?: string }>;
};

const getPlugin = (): TapToPayPlugin | null => {
  try {
    if (typeof window === "undefined") return null;
    const cap = (window as any).Capacitor;
    if (!cap?.isNativePlatform?.()) return null;
    // isPluginAvailable is the canonical "is the native side here?" check;
    // treat only an explicit false as absent (older bridges omit it).
    if (cap.isPluginAvailable?.("TapToPay") === false) return null;
    return (cap.Plugins?.TapToPay as TapToPayPlugin) || null;
  } catch {
    return null;
  }
};

// True only on a native iOS build whose device + entitlement actually
// support Tap to Pay. Safe to call anywhere; resolves false off-device.
export const tapToPaySupported = async (): Promise<boolean> => {
  const plugin = getPlugin();
  if (!plugin) return false;
  try {
    const r = await plugin.isSupported();
    return !!r?.supported;
  } catch {
    return false;
  }
};

export type TapToPayResult =
  | { ok: true; paymentIntentId: string }
  | { ok: false; error: string; canceled?: boolean };

// Run the full charge: connection token + Terminal location, then a
// card-present PaymentIntent, then hand both to the native reader. Returns
// the captured PaymentIntent id on success.
export const collectTapToPay = async (args: {
  amountCents: number;
  appointmentId?: string;
  clientName?: string;
  currency?: string;
  description?: string;
}): Promise<TapToPayResult> => {
  const plugin = getPlugin();
  if (!plugin) return { ok: false, error: "Tap to Pay isn't available on this device." };

  let token = "";
  try {
    const { data: sess } = await getSupabase().auth.getSession();
    token = sess?.session?.access_token || "";
  } catch {
    token = "";
  }
  if (!token) return { ok: false, error: "Please sign in again." };

  const authHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };

  // 1) Connection token + Terminal location for the connected account.
  let connectionToken = "";
  let locationId = "";
  try {
    const res = await fetch("/api/stripe-connect/terminal/token", {
      method: "POST",
      headers: authHeaders,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.secret || !json?.location_id) {
      return { ok: false, error: json?.error || "Couldn't start Tap to Pay." };
    }
    connectionToken = json.secret;
    locationId = json.location_id;
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again." };
  }

  // 2) The card-present PaymentIntent.
  let clientSecret = "";
  let paymentIntentId = "";
  try {
    const res = await fetch("/api/stripe-connect/terminal/intent", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        amount_cents: args.amountCents,
        appointment_id: args.appointmentId,
        client_name: args.clientName,
        currency: args.currency,
        description: args.description,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.client_secret) {
      return { ok: false, error: json?.error || "Couldn't create the charge." };
    }
    clientSecret = json.client_secret;
    paymentIntentId = json.id || "";
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again." };
  }

  // 3) Hand off to the on-device reader.
  try {
    const out = await plugin.collectPayment({
      connectionToken,
      locationId,
      clientSecret,
      amountLabel: args.description,
    });
    if (out?.status === "succeeded") {
      return { ok: true, paymentIntentId: out.paymentIntentId || paymentIntentId };
    }
    if (out?.status === "canceled") {
      return { ok: false, error: "Payment canceled.", canceled: true };
    }
    return { ok: false, error: `Payment ${out?.status || "failed"}.` };
  } catch (e: any) {
    const msg = String(e?.message || e || "Tap to Pay failed.");
    return { ok: false, error: msg, canceled: /cancel/i.test(msg) };
  }
};
