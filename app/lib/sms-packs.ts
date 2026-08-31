// SMS credit packs — canonical pricing.
//
// Zero imports on purpose: both the API route (server) and the app
// (client) import this, so it must not pull in browser-only code.
// 1 credit = 1 text. The checkout route validates the requested
// pack against this list — client-supplied prices are never trusted.

export type SmsPack = {
  id: string;
  label: string;
  credits: number;
  priceCents: number;
};

export const SMS_PACKS: SmsPack[] = [
  { id: "starter",  label: "Starter",  credits: 250,  priceCents: 1000 },
  { id: "standard", label: "Standard", credits: 700,  priceCents: 2500 },
  { id: "pro",      label: "Pro",      credits: 1500, priceCents: 5000 },
];

export const findSmsPack = (id: string): SmsPack | null =>
  SMS_PACKS.find((p) => p.id === id) || null;

// What one outbound segment actually costs the platform: Twilio's US
// A2P rate plus the carrier pass-through fee. Lives here so the retail
// prices above and the wholesale cost below stay in one file -- the
// margin is the difference between them, and it should never take two
// files to work that out.
//
// Used for the admin dashboard's outstanding-liability estimate. A
// rough figure by nature: carrier fees drift and vary by destination,
// so treat it as an order-of-magnitude read, not an invoice.
export const SMS_COST_PER_SEGMENT_USD = 0.0123;

/**
 * Dollar value of unredeemed credits -- what the platform would owe
 * Twilio if every stylist spent their balance tomorrow. Credits are
 * prepaid, so this is money already collected against delivery not yet
 * performed.
 */
export const smsLiabilityUsd = (outstandingCredits: number): number => {
  const n = Number(outstandingCredits);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * SMS_COST_PER_SEGMENT_USD * 100) / 100;
};
