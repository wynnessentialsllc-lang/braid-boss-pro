import type { Metadata } from "next";

// The success / download page is transactional (reached only via a
// post-checkout redirect or the emailed order link, carrying a bearer
// token). Keep it out of the index — there's nothing to rank here, and a
// crawled token URL would be wasteful. The client page can't export
// metadata itself, so this server layout carries the robots directive.
export const metadata: Metadata = {
  title: "Your order · Braid Boss Pro Store",
  robots: { index: false, follow: false },
};

export default function StoreSuccessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
