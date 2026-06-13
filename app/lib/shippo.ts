// Shippo client — live carrier rates for the storefront checkout.
//
// Each stylist holds their own Shippo API token (per-stylist secret on
// shop_settings, server-only). We never expose the token to the browser;
// the rate-shopping endpoint reads it under the service role, calls Shippo,
// and returns a normalized rate list. The checkout endpoint re-fetches the
// picked rate by id to confirm the amount before charging.
//
// Domestic US only for now: the Shippo Shipment is built from the stylist's
// pickup address + the buyer's ZIP/state, with the shop's default parcel
// size and the cart's total weight (sum of products.weight_oz × quantity).
// Phase 3b will reuse the rate id to buy the label.

const SHIPPO_API = "https://api.goshippo.com";
// Shippo treats < 0.001 lb as invalid for some carriers (USPS), so we floor
// to 1 oz when the cart weight rounds to 0. A token to keep negotiation
// realistic without rejecting an otherwise valid cart.
const MIN_WEIGHT_OZ = 1;
// Cap the rate list the storefront sees. Five is enough to cover cheapest +
// fastest + a couple in between without overwhelming the buyer.
const MAX_RATES = 5;

export type ShippoParcel = {
  length: number;
  width: number;
  height: number;
  weight_oz: number;
};

// Per-shipment extras the cart can ask for. Both map to fees on the rate,
// so we have to include them at quote time (adding them at label purchase
// is too late — Shippo charges what the rate already encoded).
//   • signature_confirmation — STANDARD = adult or anyone with ID at the
//     door. Sufficient for chargeback protection on most retail goods.
//   • insurance — declared parcel value Shippo passes to the carrier. We
//     hard-cap at $5k to keep an oversized declared value from blowing
//     up a quote; carriers reject above that on most service levels.
export type ShippoExtras = {
  signature_confirmation?: "STANDARD" | null;
  insurance_amount?: number | null;
};
const MAX_INSURANCE_USD = 5000;

export type ShippoAddress = {
  name?: string | null;
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  state?: string | null;
  zip: string;
  country: string;
  // Shippo requires a non-empty email on the from address when buying a
  // label (it's how carriers deliver tracking notifications). We include
  // it on both addresses at quote time so the same shipment object can be
  // promoted to a transaction in phase 3b without re-creation.
  email?: string | null;
  phone?: string | null;
};

export type NormalizedRate = {
  id: string; // Shippo rate object_id
  carrier: string; // e.g. "USPS"
  service: string; // e.g. "Priority Mail"
  amount_cents: number;
  currency: string;
  estimated_days: number | null;
};

// Headers for every Shippo call. The 2018-02-08 API version is the current
// stable line as of writing; pin it so a Shippo rollout can't break us.
const headers = (token: string): Record<string, string> => ({
  Authorization: `ShippoToken ${token}`,
  "Shippo-API-Version": "2018-02-08",
  "Content-Type": "application/json",
});

// Normalize a raw Shippo rate row to the shape the storefront expects.
// Returns null when the row is unusable (missing id / non-numeric amount)
// so the caller can drop it silently rather than crash on a bad row.
export const normalizeRate = (raw: any): NormalizedRate | null => {
  const id = raw?.object_id ? String(raw.object_id) : "";
  if (!id) return null;
  const amount = Number(raw?.amount);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const carrier = String(raw?.provider || "").trim() || "Carrier";
  // Shippo nests service name under servicelevel.name; fall back to token /
  // empty so a renamed service doesn't blank the label.
  const service =
    String(raw?.servicelevel?.name || raw?.servicelevel?.token || "").trim() ||
    "Standard";
  const days = Number(raw?.estimated_days);
  return {
    id,
    carrier,
    service,
    amount_cents: Math.round(amount * 100),
    currency: String(raw?.currency || "USD").toUpperCase(),
    estimated_days: Number.isFinite(days) && days >= 0 ? Math.floor(days) : null,
  };
};

// Trim + cap the rate list the buyer sees. Cheapest first — a buyer who
// just wants the lowest price doesn't have to scan. Within the same price
// the faster service wins so a $0-cost tie doesn't surface a slow option.
export const sortAndCapRates = (rates: NormalizedRate[]): NormalizedRate[] => {
  return [...rates]
    .sort((a, b) => {
      if (a.amount_cents !== b.amount_cents) return a.amount_cents - b.amount_cents;
      const ad = a.estimated_days ?? 999;
      const bd = b.estimated_days ?? 999;
      return ad - bd;
    })
    .slice(0, MAX_RATES);
};

// POST /shipments — sync rate request. We pass async:false so Shippo returns
// the rates in the same response instead of forcing us to poll a job. Any
// network / 4xx / 5xx surfaces as a thrown Error with the Shippo message so
// the caller can map it to a clean buyer-facing string.
export async function fetchShipmentRates(opts: {
  token: string;
  from: ShippoAddress;
  to: ShippoAddress;
  parcel: ShippoParcel;
  extras?: ShippoExtras;
}): Promise<NormalizedRate[]> {
  const weight = Math.max(MIN_WEIGHT_OZ, Math.round(opts.parcel.weight_oz * 100) / 100);
  // Build the optional extra block. Skipped entirely when neither extra is
  // requested so the request stays minimal for the common case (no
  // signature, no declared value).
  const extra: Record<string, unknown> = {};
  if (opts.extras?.signature_confirmation === "STANDARD") {
    extra.signature_confirmation = "STANDARD";
  }
  const insAmt = Number(opts.extras?.insurance_amount);
  if (Number.isFinite(insAmt) && insAmt > 0) {
    const capped = Math.min(insAmt, MAX_INSURANCE_USD);
    extra.insurance = {
      amount: capped.toFixed(2),
      currency: "USD",
      content: "Retail goods",
    };
  }
  const body = {
    address_from: {
      name: opts.from.name || "Shop",
      street1: opts.from.street1 || "",
      street2: opts.from.street2 || "",
      city: opts.from.city || "",
      state: opts.from.state || "",
      zip: opts.from.zip,
      country: opts.from.country || "US",
      email: opts.from.email || "",
      phone: opts.from.phone || "",
    },
    address_to: {
      name: opts.to.name || "Customer",
      street1: opts.to.street1 || "",
      street2: opts.to.street2 || "",
      city: opts.to.city || "",
      state: opts.to.state || "",
      zip: opts.to.zip,
      country: opts.to.country || "US",
      email: opts.to.email || "",
      phone: opts.to.phone || "",
    },
    parcels: [
      {
        length: String(opts.parcel.length),
        width: String(opts.parcel.width),
        height: String(opts.parcel.height),
        distance_unit: "in",
        weight: String(weight),
        mass_unit: "oz",
      },
    ],
    async: false,
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };

  const res = await fetch(`${SHIPPO_API}/shipments/`, {
    method: "POST",
    headers: headers(opts.token),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Shippo ${res.status}: ${text.slice(0, 200)}`);
  }
  const data: any = await res.json();
  const raw = Array.isArray(data?.rates) ? data.rates : [];
  const normalized = raw
    .map(normalizeRate)
    .filter((r: NormalizedRate | null): r is NormalizedRate => r !== null);
  return sortAndCapRates(normalized);
}

// POST /transactions — buy the prepaid label for a previously-quoted rate.
// Sync (async:false) so we can react to a SUCCESS / ERROR in-line instead of
// polling Shippo. Returns the carrier-issued tracking + a label PDF URL on
// success. Failure paths:
//   • Rate expired / not found  → Shippo replies SUCCESS with no label_url, or
//     ERROR with messages — we surface the first message as the error.
//   • Network / 4xx / 5xx       → thrown.
// We pass label_file_type:'PDF' because PDF is what every shipping carrier
// accepts at the counter (PNG / ZPL are printer-specific).

export type PurchasedLabel = {
  transaction_id: string;
  tracking_number: string;
  tracking_url: string;
  label_url: string;
  eta: string | null;
};

export async function buyLabel(
  token: string,
  rateId: string,
): Promise<PurchasedLabel> {
  const body = {
    rate: rateId,
    label_file_type: "PDF",
    async: false,
  };
  const res = await fetch(`${SHIPPO_API}/transactions/`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Shippo ${res.status}: ${text.slice(0, 200)}`);
  }
  const data: any = await res.json();
  // Shippo's status field: 'SUCCESS' | 'QUEUED' | 'WAITING' | 'ERROR'. We use
  // async:false so anything other than SUCCESS is treated as a hard fail and
  // mapped to the first message Shippo gave us.
  const status = String(data?.status || "").toUpperCase();
  if (status !== "SUCCESS") {
    const msgs = Array.isArray(data?.messages) ? data.messages : [];
    const first = msgs.length > 0 ? String(msgs[0]?.text || "") : "";
    throw new Error(first || `Shippo refused the label (status=${status || "unknown"}).`);
  }
  return {
    transaction_id: String(data?.object_id || ""),
    tracking_number: String(data?.tracking_number || ""),
    tracking_url: String(data?.tracking_url_provider || ""),
    label_url: String(data?.label_url || ""),
    eta: data?.eta ? String(data.eta) : null,
  };
}

// GET /carrier_accounts — used by the Settings "Test connection" button to
// confirm the stylist's token is valid and tell them which carriers will
// quote. Returns the human-readable carrier names of every active account,
// or throws on auth failure / network error so the caller can map the
// error to a clear UI message.
export async function listCarrierAccounts(
  token: string,
): Promise<{ name: string; carrier: string; test: boolean }[]> {
  const res = await fetch(`${SHIPPO_API}/carrier_accounts/?results=100`, {
    method: "GET",
    headers: headers(token),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Shippo rejected the token. Double-check it on goshippo.com → Settings → API.");
  }
  if (!res.ok) {
    throw new Error(`Shippo ${res.status}.`);
  }
  const data: any = await res.json();
  const rows = Array.isArray(data?.results) ? data.results : [];
  return rows
    .filter((r: any) => r && r.active)
    .map((r: any) => ({
      name: String(r.carrier_name || r.carrier || "").trim() || "Carrier",
      carrier: String(r.carrier || "").trim(),
      test: !!r.test,
    }));
}

// GET /rates/{id} — re-fetch the rate the buyer picked so the checkout
// endpoint can confirm the amount before charging. Returns null when the
// id is unknown / expired (Shippo rates expire after ~7 days) so the
// caller can ask the buyer to re-shop.
export async function fetchRateById(
  token: string,
  rateId: string,
): Promise<NormalizedRate | null> {
  const id = rateId.trim();
  if (!id) return null;
  const res = await fetch(`${SHIPPO_API}/rates/${encodeURIComponent(id)}/`, {
    method: "GET",
    headers: headers(token),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data ? normalizeRate(data) : null;
}
