// Client-paid booking fee.
//
// A flat convenience fee added to the client's online booking payment.
// The money reaches the platform WITHOUT touching the stylist's
// payout: booking checkouts are direct charges on the stylist's
// connected account, so adding the fee to both the line items and
// application_fee_amount means the client pays it, Stripe routes it to
// the platform, and the stylist still nets exactly the deposit she set.
//
// That property is the whole point. A percentage taken out of the
// deposit is a pay cut a stylist will feel and resent; a line item the
// client agrees to before paying is not.
//
// Configured by NEXT_PUBLIC_BOOKING_FEE_CENTS, deliberately public: the
// booking page must show the fee before the client commits, and the
// checkout route must charge exactly what was shown. One variable read
// by both is the only way those two can't drift apart. Unset or 0
// disables the fee everywhere, so this ships dark.

/** Hard ceiling. A "convenience fee" larger than this is a pricing
 *  change, not a fee, and almost certainly a misconfiguration. */
export const MAX_BOOKING_FEE_CENTS = 1000;

export const bookingFeeCents = (raw?: string | number | null): number => {
  const v = Number(raw ?? 0);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(MAX_BOOKING_FEE_CENTS, Math.floor(v));
};

/** The configured fee, from the environment. */
export const configuredBookingFeeCents = (): number =>
  bookingFeeCents(process.env.NEXT_PUBLIC_BOOKING_FEE_CENTS);

export const formatFee = (cents: number): string => {
  const n = Math.max(0, Math.floor(cents)) / 100;
  return `$${n.toFixed(2)}`;
};

/** Label shown to the client on the booking page and in Stripe. */
export const BOOKING_FEE_LABEL = "Booking fee";

/**
 * What the client actually pays, given the amount going to the
 * stylist. Returned separately so callers never have to re-derive the
 * split and risk charging one number while displaying another.
 */
export type BookingCharge = {
  /** Cents to the stylist — unchanged by the fee. */
  stylistCents: number;
  /** Cents to the platform. */
  feeCents: number;
  /** Cents the client is charged in total. */
  totalCents: number;
};

export const bookingCharge = (
  stylistCents: number,
  feeCents: number = configuredBookingFeeCents(),
): BookingCharge => {
  const base = Math.max(0, Math.floor(Number(stylistCents) || 0));
  // No base payment means nothing is being collected online, so there
  // is nothing to attach a fee to — charging one alone would bill a
  // client for the privilege of a free booking.
  const fee = base > 0 ? bookingFeeCents(feeCents) : 0;
  return { stylistCents: base, feeCents: fee, totalCents: base + fee };
};
