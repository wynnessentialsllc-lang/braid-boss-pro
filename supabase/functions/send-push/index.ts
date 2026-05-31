// Edge Function: send-push
//
// Production Web Push dispatcher for Braid Boss Pro.
//
// Deploy:
//   supabase functions deploy send-push
//
// Required secrets (supabase secrets set …):
//   VAPID_PUBLIC_KEY     — base64url-encoded VAPID public key
//   VAPID_PRIVATE_KEY    — base64url-encoded VAPID private key
//   VAPID_SUBJECT        — mailto: or https: URI identifying the sender
//
// Auto-provided by the Supabase platform:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Caller contract:
//   The function always sends to the *currently authenticated user*. The
//   user is resolved from the JWT on the Authorization header — clients
//   cannot dispatch pushes to other users. (If the body includes a
//   `user_id` it must match the authed user, otherwise 403.)
//
//   Body is optional. When omitted, the function sends a default test
//   notification ("Your push notifications are working.") which is what
//   the frontend "Test notification" button uses.
//
//   Example:
//     await supabase.functions.invoke("send-push", {
//       body: { payload: { title: "…", body: "…", data: { url: "/" } } },
//     });
//
// iOS PWA: Web Push works on iOS 16.4+ when the app is installed to the
// home screen. The browser-side subscription stores the same VAPID
// endpoint shape as desktop Chrome/Firefox, so this dispatcher needs no
// platform branching — but the payload `icon` must be reachable from
// the installed PWA scope, hence the absolute "/icons/icon-192.png".
//
// deno-lint-ignore-file no-explicit-any

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
// IMPORTANT: use the npm: specifier (not esm.sh). Supabase Edge
// Functions run on Deno with Node compat, and `web-push` relies on
// node:crypto / node:url which esm.sh does not always shim correctly
// — that's the symptom that surfaces in supabase-js as
// "Failed to send a request to the Edge Function" because the function
// crashes on import and never serves the request.
import webpush from "npm:web-push@3.6.7";

// ────────────────────────────────────────────────────────────────────────────
// Env

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "";

const VAPID_READY = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);

if (VAPID_READY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  } catch (err) {
    console.error("[send-push] Failed to set VAPID details:", err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CORS

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });

// ────────────────────────────────────────────────────────────────────────────
// Types

type PushPayload = {
  title?: string;
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
};

type RequestBody = {
  user_id?: string;
  // Shorthand: `{ type: "test" }` is treated like an empty body so the
  // server-side defaults render. Anything else in `type` is reserved
  // for future use (e.g. "appointment_reminder").
  type?: string;
  payload?: PushPayload;
};

type SubscriptionRow = {
  id: string;
  endpoint: string | null;
  keys: { p256dh?: string; auth?: string } | null;
  platform: string | null;
};

type SendResult = {
  ok: number;
  failed: number;
  pruned: number;
  total: number;
  errors: { id: string; status?: number; message: string }[];
};

// ────────────────────────────────────────────────────────────────────────────
// Defaults

const DEFAULT_PAYLOAD: Required<Pick<PushPayload, "title" | "body" | "icon">> = {
  title: "Braid Boss Pro",
  body: "Your push notifications are working.",
  icon: "/icons/icon-192.png",
};

const buildMessage = (input: PushPayload | undefined): string => {
  const merged: PushPayload = {
    title: input?.title || DEFAULT_PAYLOAD.title,
    body: input?.body || DEFAULT_PAYLOAD.body,
    icon: input?.icon || DEFAULT_PAYLOAD.icon,
    badge: input?.badge,
    tag: input?.tag,
    data: input?.data ?? {},
  };
  return JSON.stringify(merged);
};

// ────────────────────────────────────────────────────────────────────────────
// Handler

const handle = async (req: Request): Promise<Response> => {
  // Preflight — must work BEFORE any other check so the browser can
  // get past the CORS preflight even if env / auth is misconfigured.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json(405, { error: "method not allowed" });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("[send-push] Supabase platform env vars missing");
    return json(500, { error: "server misconfigured" });
  }

  if (!VAPID_READY) {
    console.error("[send-push] VAPID secrets not configured");
    return json(503, {
      error: "VAPID keys not configured",
      hint: "Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT via supabase secrets set",
    });
  }

  // ── Auth: resolve the caller from the JWT
  const authHeader =
    req.headers.get("Authorization") || req.headers.get("authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return json(401, { error: "missing bearer token" });
  }
  const jwt = authHeader.slice(7).trim();

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Internal service-role bypass — when the Bearer token decodes as
  // a service_role JWT, skip user auth. body.user_id (required for
  // this branch) becomes the dispatch target. Used by SECURITY DEFINER
  // SQL (via pg_net) to push from anon-authenticated flows like
  // /review/<token> submissions. Decoding the role claim instead of
  // string-matching SERVICE_ROLE_KEY makes this resilient to Supabase
  // platform key rotation.
  const decodeRole = (token: string): string | null => {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const padded = parts[1] + "===".slice((parts[1].length + 3) % 4);
      const decoded = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
      const payload = JSON.parse(decoded) as { role?: string };
      return typeof payload.role === "string" ? payload.role : null;
    } catch {
      return null;
    }
  };
  const isInternalCall = jwt === SERVICE_ROLE_KEY || decodeRole(jwt) === "service_role";
  let authedUserId: string;
  if (isInternalCall) {
    // Defer body parsing to the shared block below — but we need
    // user_id now. Cheap peek without consuming the stream is
    // impossible, so we'll resolve authedUserId after the parse.
    authedUserId = ""; // placeholder; resolved below
  } else {
    const { data: userResult, error: authError } = await admin.auth.getUser(jwt);
    if (authError || !userResult?.user) {
      console.warn("[send-push] auth.getUser failed:", authError?.message);
      return json(401, { error: "invalid or expired token" });
    }
    authedUserId = userResult.user.id;
  }

  // ── Parse body (optional)
  let body: RequestBody = {};
  const contentLength = req.headers.get("content-length");
  if (contentLength !== "0") {
    try {
      const text = await req.text();
      body = text ? (JSON.parse(text) as RequestBody) : {};
    } catch (err) {
      console.warn("[send-push] bad json body:", err);
      return json(400, { error: "invalid JSON body" });
    }
  }

  if (isInternalCall) {
    // Internal call must specify body.user_id (the target stylist).
    if (!body.user_id) {
      return json(400, { error: "internal call requires user_id in body" });
    }
    authedUserId = body.user_id;
  } else if (body.user_id && body.user_id !== authedUserId) {
    console.warn(
      "[send-push] cross-user dispatch refused. authed=%s requested=%s",
      authedUserId,
      body.user_id,
    );
    return json(403, { error: "cannot dispatch to another user" });
  }

  // ── Load this user's enabled web subscriptions
  const { data: subs, error: subsError } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, keys, platform")
    .eq("user_id", authedUserId)
    .eq("enabled", true)
    .eq("platform", "web");

  if (subsError) {
    console.error("[send-push] failed to load subscriptions:", subsError);
    return json(500, {
      error: "failed to load subscriptions",
      detail: subsError.message,
    });
  }

  const subscriptions = (subs || []) as SubscriptionRow[];

  if (subscriptions.length === 0) {
    console.info(
      "[send-push] no active web subscriptions for user",
      authedUserId,
    );
    return json(200, {
      ok: 0,
      failed: 0,
      pruned: 0,
      total: 0,
      errors: [],
      message: "No active web subscriptions for this user.",
    });
  }

  // ── Dispatch
  const message = buildMessage(body.payload);
  const result: SendResult = {
    ok: 0,
    failed: 0,
    pruned: 0,
    total: subscriptions.length,
    errors: [],
  };

  await Promise.all(
    subscriptions.map(async (s) => {
      if (!s.endpoint || !s.keys?.p256dh || !s.keys?.auth) {
        result.failed += 1;
        result.errors.push({ id: s.id, message: "missing endpoint or keys" });
        return;
      }
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.keys.p256dh, auth: s.keys.auth },
          },
          message,
          {
            // 24h retry window so a briefly-offline phone still gets
            // the push when it comes back online (vs the old 60s
            // drop-on-failure default).
            TTL: 86400,
            // Tell APNs / FCM to deliver immediately instead of
            // batching with low-priority notifications. Critical on
            // iOS PWAs, which otherwise throttle hard.
            urgency: "high",
          },
        );
        result.ok += 1;
      } catch (err) {
        const e = err as {
          statusCode?: number;
          status?: number;
          body?: string;
          message?: string;
        };
        const code = e.statusCode ?? e.status;
        const msg = e.message || e.body || "send failed";
        if (code === 404 || code === 410) {
          // Endpoint is permanently dead. Prune.
          const { error: delErr } = await admin
            .from("push_subscriptions")
            .delete()
            .eq("id", s.id);
          if (delErr) {
            console.error(
              "[send-push] prune failed for %s: %s",
              s.id,
              delErr.message,
            );
            result.failed += 1;
            result.errors.push({
              id: s.id,
              status: code,
              message: `prune failed: ${delErr.message}`,
            });
          } else {
            console.info(
              "[send-push] pruned dead subscription %s (status %s)",
              s.id,
              code,
            );
            result.pruned += 1;
          }
        } else {
          console.error(
            "[send-push] send failed for %s (status %s): %s",
            s.id,
            code,
            msg,
          );
          result.failed += 1;
          result.errors.push({ id: s.id, status: code, message: msg });
        }
      }
    }),
  );

  console.info(
    "[send-push] user=%s total=%d ok=%d failed=%d pruned=%d",
    authedUserId,
    result.total,
    result.ok,
    result.failed,
    result.pruned,
  );

  return json(200, result);
};

// Top-level wrapper: any unexpected throw still produces a JSON
// response with CORS headers so the browser sees a proper response
// instead of "Failed to send a request to the Edge Function".
serve(async (req: Request): Promise<Response> => {
  try {
    return await handle(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[send-push] unhandled error:", message, err);
    return json(500, { error: "internal error", detail: message });
  }
});
