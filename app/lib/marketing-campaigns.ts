// Marketing campaigns — composer + scheduler client API.
//
// Pairs with the marketing_campaigns table + process_marketing_campaign
// RPC from the 20260723 migration. The composer screen uses these
// to load/save drafts, run a recipient-count preview against the
// chosen segment, and trigger send-now or schedule.

import { getSupabase } from "./supabase";

export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "failed";

// Segment definition. Mirrors the JSON shape the process_marketing_
// campaign RPC consumes. Keep the union narrow — adding a kind here
// requires extending the SQL processor too.
export type CampaignSegment =
  | { kind: "all" }
  | { kind: "active_last"; days: number }
  | { kind: "lapsed"; min_days: number }
  | { kind: "manual"; client_ids: string[] };

export type MarketingCampaign = {
  id: string;
  user_id: string;
  name: string;
  subject: string;
  body_text: string;
  segment: CampaignSegment;
  status: CampaignStatus;
  scheduled_for: string | null;
  sent_at: string | null;
  recipient_count: number | null;
  failed_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type CampaignDraft = {
  id?: string;
  name: string;
  subject: string;
  body_text: string;
  segment: CampaignSegment;
};

export const SEGMENT_LABELS: Record<string, string> = {
  all:          "All clients",
  active_last:  "Booked recently",
  lapsed:       "Lapsed clients",
  manual:       "Specific clients",
};

export const describeSegment = (s: CampaignSegment): string => {
  if (!s || s.kind === "all") return "Everyone who's opted in";
  if (s.kind === "active_last") return `Booked in the last ${s.days} days`;
  if (s.kind === "lapsed") return `Haven't booked in ${s.min_days}+ days`;
  if (s.kind === "manual") {
    const n = s.client_ids?.length || 0;
    return `${n} hand-picked client${n === 1 ? "" : "s"}`;
  }
  return "";
};

export const listCampaigns = async (userId: string): Promise<MarketingCampaign[]> => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("marketing_campaigns")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data || []) as MarketingCampaign[];
};

export const saveCampaign = async (
  userId: string,
  draft: CampaignDraft,
): Promise<MarketingCampaign> => {
  const supabase = getSupabase();
  const payload = {
    user_id: userId,
    name: draft.name.trim(),
    subject: draft.subject.trim(),
    body_text: draft.body_text,
    segment: draft.segment,
    updated_at: new Date().toISOString(),
  };
  if (draft.id) {
    const { data, error } = await supabase
      .from("marketing_campaigns")
      .update(payload)
      .eq("id", draft.id)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (error || !data) throw error || new Error("Couldn't save campaign.");
    return data as MarketingCampaign;
  } else {
    const { data, error } = await supabase
      .from("marketing_campaigns")
      .insert({ ...payload, status: "draft" })
      .select("*")
      .maybeSingle();
    if (error || !data) throw error || new Error("Couldn't save campaign.");
    return data as MarketingCampaign;
  }
};

// Schedule a draft for a future send. The cron picks up campaigns
// with status='scheduled' and scheduled_for <= now() every 15
// minutes. Pass null to unschedule a campaign back to draft.
export const scheduleCampaign = async (
  userId: string,
  campaignId: string,
  scheduledFor: string | null,
): Promise<void> => {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("marketing_campaigns")
    .update({
      status: scheduledFor ? "scheduled" : "draft",
      scheduled_for: scheduledFor,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId)
    .eq("user_id", userId);
  if (error) throw error;
};

// Fire the campaign immediately. RPC enqueues a notification per
// recipient and flips status to 'sent'. Returns the recipient count.
export const sendCampaignNow = async (campaignId: string): Promise<number> => {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("process_marketing_campaign", {
    campaign_id_in: campaignId,
  });
  if (error) throw error;
  return Number(data) || 0;
};

// Preview helper for the composer's "Send to N clients" pill.
export const countSegment = async (segment: CampaignSegment): Promise<number> => {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("count_marketing_segment", {
    segment_in: segment,
  });
  if (error) throw error;
  return Number(data) || 0;
};

// One row per client a campaign was enqueued for, with the delivery
// outcome from the notification queue.
export type CampaignRecipient = {
  clientId: string | null;
  name: string | null;
  email: string | null;
  status: string;        // queued | processing | sent | failed
  sentAt: string | null;
  failureReason: string | null;
};

// Who a campaign actually went to. Reads the notification_queue rows
// the send produced, via an owner-scoped RPC.
export const fetchCampaignRecipients = async (
  campaignId: string,
): Promise<CampaignRecipient[]> => {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("list_campaign_recipients", {
    campaign_id_in: campaignId,
  });
  if (error) throw error;
  return ((data || []) as any[]).map(r => ({
    clientId: r.client_id ?? null,
    name: r.recipient_name ?? null,
    email: r.recipient_email ?? null,
    status: String(r.status || "queued"),
    sentAt: r.sent_at ?? null,
    failureReason: r.failure_reason ?? null,
  }));
};

export const deleteCampaign = async (
  userId: string,
  campaignId: string,
): Promise<void> => {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("marketing_campaigns")
    .delete()
    .eq("id", campaignId)
    .eq("user_id", userId);
  if (error) throw error;
};
