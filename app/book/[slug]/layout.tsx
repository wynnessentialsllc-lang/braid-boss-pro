import type { Metadata } from "next";
import type { ReactNode } from "react";

// Server-rendered metadata for /book/<slug>. app/book/[slug]/page.tsx is
// a "use client" component and can't export metadata of its own; it does
// patch <title> + OG tags client-side, but link-preview crawlers
// (iMessage, Slack, WhatsApp, Discord, etc.) don't execute JavaScript,
// so without this layout they fall through to the root marketing card.
//
// We resolve the same anon-callable RPC the page uses
// (public_resolve_booking_slug) and emit per-stylist title +
// description. The per-stylist og:image is supplied by the sibling
// opengraph-image.tsx, which Next.js auto-discovers for this route.

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://bjqazhplxqqhftekspfl.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_b-GByxuYeehWa-9F7Z1MdQ_FKqx32XO";

type Resolved = {
  businessName: string | null;
  intro: string | null;
  tagline: string | null;
};

async function resolve(slug: string): Promise<Resolved> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/public_resolve_booking_slug`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ slug_in: slug }),
        cache: "no-store",
      },
    );
    if (!res.ok) return { businessName: null, intro: null, tagline: null };
    const data = await res.json();
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || !row.link_id) {
      return { businessName: null, intro: null, tagline: null };
    }
    return {
      businessName: (row.business_name as string | null)?.trim() || null,
      intro: (row.intro as string | null)?.trim() || null,
      tagline: (row.tagline as string | null)?.trim() || null,
    };
  } catch {
    return { businessName: null, intro: null, tagline: null };
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { businessName, intro, tagline } = await resolve(slug);

  const title = businessName
    ? `Book with ${businessName} · Braid Boss Pro`
    : "Book an appointment · Braid Boss Pro";
  const description =
    intro
    || tagline
    || (businessName
      ? `Book your next appointment with ${businessName}.`
      : "Book your next braiding appointment online.");

  return {
    title,
    description,
    openGraph: {
      type: "website",
      title,
      description,
      url: `/book/${slug}`,
      // og:image is supplied by app/book/[slug]/opengraph-image.tsx
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default function BookLayout({ children }: { children: ReactNode }) {
  return children;
}
