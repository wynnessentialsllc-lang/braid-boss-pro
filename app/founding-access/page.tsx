// The $9.99 one-time Founding / Lifetime offer has ended. This sales
// page now redirects to /pricing, where the current offer (a 14-day
// free trial, then $14.99/month) lives.
//
// Existing founding & lifetime members keep their access — it's stored
// on their profile and honored everywhere. The /founding-success page
// is intentionally left in place for anyone still completing an
// in-flight payment.
import { redirect } from "next/navigation";

export default function FoundingAccessPage() {
  redirect("/pricing");
}
