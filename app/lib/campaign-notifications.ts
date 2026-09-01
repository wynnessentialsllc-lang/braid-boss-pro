// Campaign send collapsing for the notification bell.
//
// A marketing campaign queues one email per recipient, and each of
// those queue rows is mirrored into its own bell entry (migration
// 20260808). Sending to 40 clients therefore buried every actionable
// alert under 40 identical "Campaign sent" cards. The bell folds each
// send into a single row that names who it went to; the pure part of
// that lives here so it can be tested away from the UI.

// Per-recipient detail carried on a mirrored "Campaign sent" row.
export type CampaignRecipientRef = {
  // Groups rows from the same send — see campaignGroupKey.
  key: string;
  name: string;
  email: string | null;
  queueId: string | null;
  subject: string | null;
};

export const CAMPAIGN_GROUP_PREFIX = "campaign-group:";

// One send's identity. process_marketing_campaign stamps `campaignId`
// on every queue row and the mirror trigger carries it into
// notifications.data (migration 20261258), so normally this is exact.
// Rows mirrored before that fall back to subject + send day, which
// separates two campaigns without ever splitting one send (all of a
// send's rows are written in the same transaction).
export const campaignGroupKey = (
  campaignId: string | null | undefined,
  subject: string | null | undefined,
  createdAt: string | null | undefined,
): string => {
  const id = String(campaignId || "").trim();
  if (id) return id;
  return `subject:${subject || ""}|${String(createdAt || "").slice(0, 10)}`;
};

// "To Jessica Shepherd, Bailey Cooper, Penny Bygrave +12 more" — the
// bell row's body is clamped to two lines, so lead with real names
// rather than a bare count.
const NAMED_RECIPIENTS = 3;
export const summarizeRecipients = (names: string[]): string => {
  const usable = names.filter(n => !!n && n.trim().length > 0);
  if (usable.length === 0) return "";
  const shown = usable.slice(0, NAMED_RECIPIENTS).join(", ");
  const rest = usable.length - Math.min(usable.length, NAMED_RECIPIENTS);
  return rest > 0 ? `To ${shown} +${rest} more` : `To ${shown}`;
};

export type CampaignGrouped<T> =
  | { kind: "single"; item: T }
  | { kind: "group"; key: string; members: T[] };

// Walks the list once and replaces every run of same-campaign rows with
// a single group, positioned where that campaign's first (newest) row
// was — so the bell stays in reverse-chronological order. A campaign
// that only reached one client is left alone: there is nothing to
// collapse, and a lone "Campaign sent to 1 client" row would read worse
// than the original.
export const groupCampaignRows = <T extends { campaign?: CampaignRecipientRef }>(
  items: T[],
): Array<CampaignGrouped<T>> => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.campaign?.key;
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  const emitted = new Set<string>();
  const out: Array<CampaignGrouped<T>> = [];
  for (const item of items) {
    const key = item.campaign?.key;
    const members = key ? groups.get(key) : undefined;
    if (!key || !members || members.length < 2) {
      out.push({ kind: "single", item });
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    out.push({ kind: "group", key, members });
  }
  return out;
};
