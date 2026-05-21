"use client";

// Public marketplace — "Find a braider near you".
//
// No login. Anyone can search opted-in Braid Boss Pro stylists by
// city and tap through to a stylist's booking page. Data comes from
// the anon-callable public_discover_stylists RPC; the page only ever
// sees stylists who opted in and have an active booking link.

import { Suspense, useCallback, useEffect, useState } from "react";
import {
  fetchDiscoverStylists,
  fetchStylistReviews,
  priceRangeLabel,
  type DiscoverStylist,
  type StylistReview,
} from "../lib/marketplace";

const C = {
  cream: "#FFFFFF",
  ivory: "#F6F2EC",
  espresso: "#15111A",
  coffee: "#3D3447",
  gold: "#7C3AED",
  goldDeep: "#5B21B6",
  muted: "#6F6477",
  hairline: "rgba(21, 17, 26, 0.12)",
} as const;
const FONT_DISPLAY = "'Cormorant Garamond', 'Playfair Display', Georgia, serif";

const fmtReviewDate = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
};

const Stars = ({ n }: { n: number }) => {
  const full = Math.max(0, Math.min(5, Math.round(n)));
  return (
    <span style={{ color: C.goldDeep, fontSize: 13, letterSpacing: 1 }} aria-label={`${full} out of 5 stars`}>
      {"★".repeat(full)}<span style={{ color: C.hairline }}>{"★".repeat(5 - full)}</span>
    </span>
  );
};

// Expandable reviews panel — fetched lazily the first time the
// rating is tapped.
const ReviewsPanel = ({ reviews, loading }: { reviews: StylistReview[] | null; loading: boolean }) => {
  if (loading) {
    return <p style={{ fontSize: 12, color: C.muted, padding: "10px 0 0" }}>Loading reviews…</p>;
  }
  if (!reviews || reviews.length === 0) {
    return <p style={{ fontSize: 12, color: C.muted, padding: "10px 0 0" }}>No written reviews yet.</p>;
  }
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.hairline}` }}>
      {reviews.map((r, i) => (
        <div key={i} style={{ paddingTop: i === 0 ? 0 : 12, marginTop: i === 0 ? 0 : 12, borderTop: i === 0 ? "none" : `1px solid ${C.hairline}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Stars n={r.stars} />
            <span style={{ fontSize: 12, fontWeight: 600, color: C.espresso }}>
              {r.displayName || "Client"}
            </span>
            {fmtReviewDate(r.submittedAt) && (
              <span style={{ fontSize: 11, color: C.muted }}>· {fmtReviewDate(r.submittedAt)}</span>
            )}
          </div>
          {r.notes && (
            <p style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.5, color: C.coffee }}>
              {r.notes}
            </p>
          )}
        </div>
      ))}
    </div>
  );
};

const StylistCard = ({ s }: { s: DiscoverStylist }) => {
  const where = [s.city, s.state].filter(Boolean).join(", ");
  const price = priceRangeLabel(s.priceMin, s.priceMax);
  const bookHref = `/book/${encodeURIComponent(s.slug)}`;
  const hasReviews = s.ratingCount > 0 && s.ratingAvg != null;

  const [open, setOpen] = useState(false);
  const [reviews, setReviews] = useState<StylistReview[] | null>(null);
  const [loadingReviews, setLoadingReviews] = useState(false);

  const toggleReviews = async () => {
    const next = !open;
    setOpen(next);
    // Lazy-fetch on first open.
    if (next && reviews == null && !loadingReviews) {
      setLoadingReviews(true);
      try { setReviews(await fetchStylistReviews(s.slug)); }
      catch { setReviews([]); }
      finally { setLoadingReviews(false); }
    }
  };

  return (
    <div style={{
      background: "#FFFFFF",
      border: `1px solid ${C.hairline}`,
      borderRadius: 16,
      padding: 16,
      marginBottom: 12,
    }}>
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <a href={bookHref} style={{ flexShrink: 0, lineHeight: 0 }}>
          {s.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={s.logoUrl}
              alt=""
              style={{ width: 56, height: 56, borderRadius: 12, objectFit: "cover" }}
            />
          ) : (
            <div style={{
              width: 56, height: 56, borderRadius: 12,
              background: C.ivory, display: "grid", placeItems: "center",
              fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 600, color: C.goldDeep,
            }}>
              {(s.businessName || "?").trim().charAt(0).toUpperCase()}
            </div>
          )}
        </a>
        <div style={{ minWidth: 0, flex: 1 }}>
          <a href={bookHref} style={{ textDecoration: "none" }}>
            <p style={{
              margin: 0, fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 600,
              color: C.espresso, lineHeight: 1.15,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {s.businessName}
            </p>
          </a>
          {where && (
            <p style={{ margin: "2px 0 0", fontSize: 12, color: C.muted }}>{where}</p>
          )}
          <div style={{ marginTop: 4 }}>
            {hasReviews ? (
              <button
                type="button"
                onClick={toggleReviews}
                style={{
                  background: "transparent", border: 0, padding: 0, cursor: "pointer",
                  fontSize: 12, color: C.coffee, display: "inline-flex", alignItems: "center", gap: 4,
                }}
              >
                <span style={{ color: C.goldDeep, fontWeight: 700 }}>★ {s.ratingAvg!.toFixed(1)}</span>
                <span>· {s.ratingCount} review{s.ratingCount === 1 ? "" : "s"}</span>
                <span style={{ color: C.goldDeep, fontWeight: 700 }}>{open ? "▴ Hide" : "▾ Read"}</span>
              </button>
            ) : (
              <span style={{ fontSize: 12, color: C.muted }}>No reviews yet</span>
            )}
          </div>
        </div>
      </div>

      {s.intro && (
        <p style={{
          margin: "12px 0 0", fontSize: 13, lineHeight: 1.5, color: C.coffee,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {s.intro}
        </p>
      )}

      {open && <ReviewsPanel reviews={reviews} loading={loadingReviews} />}

      <div style={{
        marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.hairline}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{ fontSize: 12, color: C.muted }}>
          {price ? `Services from ${price}` : "View services"}
        </span>
        <a href={bookHref} style={{
          fontSize: 12, fontWeight: 700, color: "#FFFFFF", background: C.espresso,
          padding: "7px 14px", borderRadius: 999, letterSpacing: "0.04em", textDecoration: "none",
        }}>
          Book
        </a>
      </div>
    </div>
  );
};

const DiscoverInner = () => {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [results, setResults] = useState<DiscoverStylist[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const run = useCallback(async (city: string) => {
    setLoading(true);
    setErr(null);
    try {
      setResults(await fetchDiscoverStylists(city));
    } catch (e: any) {
      setErr(e?.message || "Couldn't load braiders right now.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Browse-all on first load.
  useEffect(() => { void run(""); }, [run]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(query.trim());
    void run(query);
  };

  return (
    <div style={{
      minHeight: "100dvh",
      background: C.cream,
      color: C.espresso,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      paddingTop: "max(28px, env(safe-area-inset-top))",
      paddingBottom: "max(40px, calc(env(safe-area-inset-bottom) + 24px))",
      paddingLeft: 18,
      paddingRight: 18,
    }}>
      <div style={{ width: "100%", maxWidth: 480, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <p style={{
            margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.24em",
            textTransform: "uppercase", color: C.goldDeep,
          }}>
            Braid Boss Pro
          </p>
          <h1 style={{
            margin: "6px 0 0", fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 600,
            color: C.espresso, lineHeight: 1.1,
          }}>
            Find a braider near you
          </h1>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
            Real braiders, real reviews, instant booking.
          </p>
        </div>

        <form onSubmit={onSearch} style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by city — e.g. Los Angeles"
            style={{
              flex: 1, padding: "12px 14px", fontSize: 14,
              borderRadius: 12, border: `1px solid ${C.hairline}`,
              background: "#FFFFFF", color: C.espresso, outline: "none",
            }}
          />
          <button
            type="submit"
            style={{
              padding: "12px 18px", fontSize: 14, fontWeight: 600,
              borderRadius: 12, border: 0, background: C.espresso, color: "#FFFFFF",
              letterSpacing: "0.03em",
            }}
          >
            Search
          </button>
        </form>

        {loading ? (
          <p style={{ textAlign: "center", color: C.muted, fontSize: 13, padding: "40px 0" }}>
            Loading braiders…
          </p>
        ) : err ? (
          <p style={{ textAlign: "center", color: "#9C3D2E", fontSize: 13, padding: "40px 0" }}>
            {err}
          </p>
        ) : (results && results.length > 0) ? (
          <>
            <p style={{ fontSize: 12, color: C.muted, margin: "0 0 10px" }}>
              {results.length} braider{results.length === 1 ? "" : "s"}
              {submitted ? ` in “${submitted}”` : ""}
            </p>
            {results.map(s => <StylistCard key={s.slug} s={s} />)}
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "40px 12px" }}>
            <p style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.espresso, margin: 0 }}>
              {submitted ? `No braiders found in “${submitted}”` : "No braiders listed yet"}
            </p>
            <p style={{ fontSize: 13, color: C.muted, margin: "8px 0 0", lineHeight: 1.5 }}>
              {submitted
                ? "Try a nearby city, or search without a city to see everyone."
                : "Check back soon — braiders are joining all the time."}
            </p>
            {submitted && (
              <button
                type="button"
                onClick={() => { setQuery(""); setSubmitted(""); void run(""); }}
                style={{
                  marginTop: 14, padding: "10px 18px", fontSize: 13, fontWeight: 600,
                  borderRadius: 999, border: `1px solid ${C.hairline}`,
                  background: "transparent", color: C.espresso,
                }}
              >
                Show all braiders
              </button>
            )}
          </div>
        )}

        <p style={{
          textAlign: "center", fontSize: 11, color: C.muted, marginTop: 24, lineHeight: 1.5,
        }}>
          Are you a braider? <a href="/" style={{ color: C.goldDeep, fontWeight: 600 }}>Get Braid Boss Pro</a> to get listed.
        </p>
      </div>
    </div>
  );
};

export default function DiscoverPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#6F6477" }}>Loading…</div>}>
      <DiscoverInner />
    </Suspense>
  );
}
