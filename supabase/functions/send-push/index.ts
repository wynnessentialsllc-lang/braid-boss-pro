// Edge Function: send-push
// Deploy with:
//   supabase functions deploy send-push
//   supabase secrets set VAPID_PUBLIC_KEY=...  VAPID_PRIVATE_KEY=...  VAPID_SUBJECT=mailto:owner@example.com
//
// Callable from inside the app (or a future cron) with:
//   const { data, error } = await supabase.functions.invoke("send-push", {
//     body: { user_id, payload: { title, body, data: { url } } },
//   });
//
// V1 implements only Web Push; native iOS / Android dispatch will land
// when we wrap with Capacitor and integrate APNs / FCM. Until VAPID
// secrets are configured the function short-circuits with a clear
// 503 so the rest of the system is testable.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "https://esm.sh/web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:owner@example.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

type Payload = {
  user_id: string;
  payload: { title?: string; body?: string; data?: any; tag?: string; icon?: string };
};

serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return new Response(JSON.stringify({ error: "VAPID keys not configured" }), { status: 503, headers: { "content-type": "application/json" } });
  }

  let body: Payload;
  try { body = await req.json(); }
  catch { return new Response("bad json", { status: 400 }); }
  if (!body.user_id) return new Response("user_id required", { status: 400 });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, keys, platform")
    .eq("user_id", body.user_id)
    .eq("enabled", true)
    .eq("platform", "web");

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const message = JSON.stringify(body.payload || {});
  const results: { ok: number; failed: number; pruned: number } = { ok: 0, failed: 0, pruned: 0 };

  await Promise.all((subs || []).map(async (s: any) => {
    if (!s.endpoint || !s.keys) return;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, message);
      results.ok += 1;
    } catch (err: any) {
      // 404 / 410 → endpoint is gone; prune.
      const code = err?.statusCode || err?.status;
      if (code === 404 || code === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", s.id);
        results.pruned += 1;
      } else {
        results.failed += 1;
      }
    }
  }));

  return new Response(JSON.stringify(results), { status: 200, headers: { "content-type": "application/json" } });
});
