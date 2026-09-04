// POST /api/admin/approve-stylist
//
//   { user_id: string, approved: boolean }
//
// Flips profiles.platform_approved via the admin_set_platform_approval
// RPC. Same two-gate pattern as /api/admin/command-center: a Bearer JWT
// that resolves to the single admin email, re-checked inside the
// SECURITY DEFINER RPC.
//
// This is the only way a newly-onboarded stylist's checkout routes
// (booking deposit/full payment, memberships, packages, products,
// videos, classes, balance payments, manual card charges, no-show
// fees) start accepting real charges — see
// 20261268000000_stylist_platform_approval.sql for why.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminUser } from "../../../lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
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

  let body: { user_id?: string; approved?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const targetUserId = String(body?.user_id || "").trim();
  if (!targetUserId || !/^[0-9a-f-]{36}$/i.test(targetUserId)) {
    return NextResponse.json({ error: "missing or malformed user_id" }, { status: 400 });
  }
  const approved = body?.approved !== false;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin.rpc("admin_set_platform_approval", {
    caller_email_in: user.email,
    target_user_id_in: targetUserId,
    approved_in: approved,
  });
  if (error) {
    console.error("[admin/approve-stylist] RPC failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, user_id: targetUserId, approved });
}
