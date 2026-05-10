// Edge Function: booking-request
//
// Anonymous endpoint that the public /book/<slug> form posts to.
// Looks up the active booking_links row by slug, then writes a
// booking_requests row owned by the corresponding salon user_id.
// The Edge Function uses the service role key, so rows are inserted
// past RLS — but only after slug validation, and the inserted row
// pins the correct user_id so the salon owner's policies still
// scope ownership for their downstream reads.
//
// CORS: allow all origins because the public booking page may be
// hosted on whatever domain the salon is using.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders: HeadersInit = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const json = (status: number, body: any) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "content-type": "application/json" },
});

const cleanString = (v: any, max = 256): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
};
const cleanDate = (v: any): string | null => {
  const s = cleanString(v, 10);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const cleanNumber = (v: any): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  let payload: any;
  try { payload = await req.json(); }
  catch { return json(400, { error: "bad json" }); }

  const slug = cleanString(payload.slug, 64);
  const clientName = cleanString(payload.clientName, 200);
  const clientPhone = cleanString(payload.clientPhone, 64);
  const clientEmail = cleanString(payload.clientEmail, 256);

  if (!slug) return json(400, { error: "slug required" });
  if (!clientName) return json(400, { error: "clientName required" });
  if (!clientPhone && !clientEmail) return json(400, { error: "phone or email required" });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: link, error: linkErr } = await supabase
    .from("booking_links")
    .select("user_id, active")
    .eq("slug", slug)
    .maybeSingle();
  if (linkErr) return json(500, { error: "server error" });
  if (!link || !link.active) return json(404, { error: "booking link not found" });

  // Snapshot the service catalog row so subsequent owner edits don't
  // rewrite history. Phase B1 consolidation migration populated the
  // canonical snapshot columns on booking_requests; new writes must
  // follow the same shape so we don't drift again.
  const serviceIdRaw = cleanString(payload.serviceId, 64);
  const isUuid = serviceIdRaw && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(serviceIdRaw);
  let snapshot: {
    service_id: string | null;
    service_name: string | null;
    service_duration: number | null;
    service_duration_hours: number | null;
    service_price: number | null;
    service_deposit_required: boolean | null;
    service_deposit_amount: number | null;
    service_prep_instructions: string | null;
  } = {
    service_id: null,
    service_name: cleanString(payload.serviceName, 200),
    service_duration: cleanNumber(payload.serviceDuration),
    service_duration_hours: cleanNumber(payload.serviceDuration),
    service_price: cleanNumber(payload.servicePrice),
    service_deposit_required: null,
    service_deposit_amount: null,
    service_prep_instructions: null,
  };

  if (isUuid) {
    const { data: svc } = await supabase
      .from("services")
      .select("id, name, duration_hours, base_price, deposit_required, deposit_amount, prep_instructions, is_active, user_id")
      .eq("id", serviceIdRaw)
      .eq("user_id", link.user_id)
      .maybeSingle();
    if (svc && svc.is_active) {
      snapshot = {
        service_id: svc.id,
        service_name: svc.name,
        service_duration: svc.duration_hours,
        service_duration_hours: svc.duration_hours,
        service_price: svc.base_price,
        service_deposit_required: svc.deposit_required,
        service_deposit_amount: svc.deposit_amount,
        service_prep_instructions: svc.prep_instructions,
      };
    }
  }

  const row = {
    user_id: link.user_id,
    link_slug: slug,
    client_name: clientName,
    client_phone: clientPhone,
    client_email: clientEmail,
    ...snapshot,
    preferred_date: cleanDate(payload.preferredDate),
    preferred_time: cleanString(payload.preferredTime, 16),
    notes: cleanString(payload.notes, 4000),
    timezone: cleanString(payload.timezone, 64),
    locale: cleanString(payload.locale, 16),
    created_from_public: true,
    source_user_agent: cleanString(req.headers.get("user-agent"), 256),
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("booking_requests")
    .insert(row)
    .select("id, created_at")
    .single();
  if (insertErr) return json(500, { error: "couldn't save request" });

  return json(200, { ok: true, id: inserted.id });
});
