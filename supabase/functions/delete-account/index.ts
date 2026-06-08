// Edge Function: delete-account
//
// Authenticated user deletes their own account. We verify the JWT
// against the request, then use the service role key to call
// auth.admin.deleteUser. Cascade deletes on every user-data table
// wipe their data at the same time.
//
// Deploy:
//   supabase functions deploy delete-account
//
// Required env (auto-provided by the platform):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

// deno-lint-ignore-file no-explicit-any
import "@supabase/functions-js/edge-runtime.d.ts";
// Pin the supabase-js version. Bare "@2" sometimes resolves to
// pre-release builds with Deno-incompatible WebCrypto changes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
};
const json = (status: number, body: any) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "content-type": "application/json" },
});

const handle = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { error: "server misconfigured" });
  }

  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json(401, { error: "missing bearer token" });

  // Explicit confirmation gate. Account deletion is irreversible and
  // wipes 16 tables + the auth user, so require the caller to send
  // { confirm: "delete" } — matching the documented contract in
  // config.toml. Defense-in-depth against an accidental or
  // token-replay POST with an empty body.
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  if ((body as Record<string, unknown>)?.confirm !== "delete") {
    return json(400, { error: "confirmation required", detail: 'send { "confirm": "delete" }' });
  }

  // Identify the requesting user from their JWT.
  const userClient = createClient(SUPABASE_URL, ANON_KEY || SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: whoErr } = await userClient.auth.getUser();
  if (whoErr || !user) {
    console.warn("[delete-account] auth.getUser failed:", whoErr?.message);
    return json(401, { error: "invalid session" });
  }

  // Best-effort wipe of app-table rows. ON DELETE CASCADE from
  // auth.users handles the rest, but explicitly clearing first
  // means the user sees their data gone even if there's a delay
  // before the auth user row is removed.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const tables = [
    // B12 tables — clear children before their parents so the
    // explicit-delete loop doesn't race FK cascades.
    "notification_queue",
    "communication_logs",
    "booking_contracts",
    "service_contract_templates",
    "contract_templates",
    "appointments",
    "clients",
    "quotes",
    "receipts",
    "communications",
    "notifications",
    "photos",
    "settings",
    "booking_requests",
    "booking_links",
    "calendar_feed_tokens",
    "push_subscriptions",
  ];
  for (const t of tables) {
    const { error } = await admin.from(t).delete().eq("user_id", user.id);
    if (error) console.warn(`[delete-account] clear ${t} failed:`, error.message);
  }

  // Finally, delete the auth user. Cascades remove anything we
  // missed above (and any tables added later).
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) {
    console.error("[delete-account] deleteUser failed:", delErr.message);
    return json(500, { error: "couldn't delete account", detail: delErr.message });
  }

  return json(200, { ok: true });
};

Deno.serve(async (req: Request): Promise<Response> => {
  try { return await handle(req); }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[delete-account] unhandled:", msg, err);
    return json(500, { error: "internal error", detail: msg });
  }
});
