// Edge Function: delete-account
//
// Authenticated user deletes their own account. We can't trust a
// client-side admin call, so we verify the JWT against the request,
// then use the service role key to call auth.admin.deleteUser. Cascade
// deletes (ON DELETE CASCADE on every user-data table) wipe their data
// at the same time.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const corsHeaders: HeadersInit = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
};
const json = (status: number, body: any) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "content-type": "application/json" },
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json(401, { error: "missing bearer token" });

  // Identify the requesting user by exchanging their JWT.
  const userClient = createClient(SUPABASE_URL, ANON_KEY || SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: whoErr } = await userClient.auth.getUser();
  if (whoErr || !user) return json(401, { error: "invalid session" });

  // Privileged client to actually delete.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) return json(500, { error: delErr.message });

  return json(200, { ok: true });
});
