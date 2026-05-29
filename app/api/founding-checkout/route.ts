// The $9.99 one-time Founding / Lifetime offer is CLOSED to new
// purchases as of the move to the $14.99/mo subscription.
//
// This endpoint used to create a Stripe Checkout Session for the
// one-time founding payment. It now returns 410 Gone so no new
// lifetime sales can be created. Everyone who already paid keeps
// lifetime access — the complementary paths remain fully live:
//   • /api/founding-checkout/webhook  — still flips in-flight orders
//     to 'paid' and grandfathers matching users.
//   • claim_founding_access_for_user  — still claims any paid order on
//     signup.
// New stylists subscribe through /api/subscribe instead.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      error: "offer_closed",
      message: "The founding lifetime offer has ended. Start a free trial instead.",
      subscribeUrl: "/pricing",
    },
    { status: 410 },
  );
}
