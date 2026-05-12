// GET /api/admin/analytics?window=30
//
// Returns the aggregated dashboard payload from
// analytics_summary_for_admin(caller_email, window_days). Two gates:
//
//   1. Server-side: must present a Bearer JWT that resolves to a user
//      whose email passes isAdminUser().
//   2. Database-side: the RPC re-checks the caller email against its
//      own allow-list and raises if it doesn't match. Defense in depth
//      so a leaked anon key still can't read analytics.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminUser } from "../../../lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "server not configured" }, { status: 500 });
  }

  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ error: "missing bearer" }, { status: 401 });
  }

  const userClient = createClient(supabaseUrl, serviceKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: whoErr } = await userClient.auth.getUser();
  if (whoErr || !user) {
    return NextResponse.json({ error: "invalid session" }, { status: 401 });
  }
  if (!isAdminUser(user.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const windowRaw = Number(url.searchParams.get("window") || 30);
  const windowDays = Number.isFinite(windowRaw) && windowRaw > 0 && windowRaw <= 365
    ? Math.floor(windowRaw)
    : 30;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("analytics_summary_for_admin", {
    caller_email_in: user.email,
    window_days_in: windowDays,
  });
  if (error) {
    console.error("[admin/analytics] RPC failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data });
}
