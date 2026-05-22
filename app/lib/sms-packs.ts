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
