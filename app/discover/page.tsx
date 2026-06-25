"use client";

// Public marketplace — "Find a braider near you".
//
// No login. Anyone can search opted-in Braid Boss Pro stylists by
// city and tap through to a stylist's booking page. Data comes from
// the anon-callable public_discover_stylists RPC; the page only ever
// sees stylists who opted in and have an active booking link.

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchDiscoverStylists,
  fetchStylistReviews,
  priceRangeLabel,
  STYLE_TAGS,
  styleLabel,
  type DiscoverStylist,
  type StylistReview,
} from "../lib/marketplace";
import {
  findBraider,
  type FindBraiderResult,
} from "../lib/find-braider";

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
          {s.coverPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={s.coverPhoto}
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

      {(s.styleTags.length > 0 || s.travels) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {s.travels && (
            <span style={{
              fontSize: 11, fontWeight: 700, color: C.goldDeep, background: C.ivory,
              border: `1px solid ${C.hairline}`, borderRadius: 999, padding: "3px 9px",
            }}>
              ✦ Travels to you
            </span>
          )}
          {s.styleTags.map(tag => (
            <span key={tag} style={{
              fontSize: 11, fontWeight: 600, color: C.coffee, background: C.ivory,
              border: `1px solid ${C.hairline}`, borderRadius: 999, padding: "3px 9px",
            }}>
              {styleLabel(tag)}
            </span>
          ))}
        </div>
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
  const [style, setStyle] = useState<string | null>(null);
  const [mobileOnly, setMobileOnly] = useState(false);
  const [results, setResults] = useState<DiscoverStylist[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const run = useCallback(async (city: string, styleSlug: string | null, mobile: boolean) => {
    setLoading(true);
    setErr(null);
    try {
      setResults(await fetchDiscoverStylists({
        city,
        style: styleSlug || undefined,
        mobileOnly: mobile || undefined,
      }));
    } catch (e: any) {
      setErr(e?.message || "Couldn't load braiders right now.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Browse-all on first load. run() flips loading state synchronously,
  // which is the intended initial fetch — same pattern the rest of the
  // app uses for load-on-mount effects.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void run("", null, false); }, [run]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(query.trim());
    void run(query, style, mobileOnly);
  };

  // Filter chips apply immediately against the current city query.
  const applyStyle = (slug: string | null) => {
    setStyle(slug);
    void run(query, slug, mobileOnly);
  };
  const applyMobile = (next: boolean) => {
    setMobileOnly(next);
    void run(query, style, next);
  };

  // --- Find My Braider (AI Style-Match) ---
  const [matchOpen, setMatchOpen] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoData, setPhotoData] = useState<{ base64: string; type: string } | null>(null);
  const [matchNotes, setMatchNotes] = useState("");
  const [matchBusy, setMatchBusy] = useState(false);
  const [matchErr, setMatchErr] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<FindBraiderResult | null>(null);

  const onPhotoPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMatchErr(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      setPhotoPreview(dataUrl);
      setPhotoData({ base64: dataUrl, type: file.type });
    };
    reader.onerror = () => setMatchErr("Couldn't read that image. Try another photo.");
    reader.readAsDataURL(file);
  };

  const runMatch = async () => {
    if (!photoData) { setMatchErr("Add a photo first."); return; }
    setMatchBusy(true);
    setMatchErr(null);
    try {
      const result = await findBraider({
        imageBase64: photoData.base64,
        mediaType: photoData.type,
        city: query,
        notes: matchNotes,
      });
      setMatchResult(result);
    } catch (e: any) {
      setMatchErr(e?.message || "Couldn't match your photo right now.");
    } finally {
      setMatchBusy(false);
    }
  };

  const clearMatch = () => {
    setMatchResult(null);
    setPhotoPreview(null);
    setPhotoData(null);
    setMatchNotes("");
    setMatchErr(null);
    setMatchOpen(false);
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
            Find Your Braider
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

        {/* Style + travel filters */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
          <button
            type="button"
            onClick={() => applyMobile(!mobileOnly)}
            style={{
              fontSize: 12, fontWeight: 700, padding: "7px 13px", borderRadius: 999,
              cursor: "pointer",
              border: `1px solid ${mobileOnly ? C.espresso : C.hairline}`,
              background: mobileOnly ? C.espresso : "#FFFFFF",
              color: mobileOnly ? "#FFFFFF" : C.coffee,
            }}
          >
            ✦ Travels to me
          </button>
          {STYLE_TAGS.map(t => {
            const active = style === t.slug;
            return (
              <button
                key={t.slug}
                type="button"
                onClick={() => applyStyle(active ? null : t.slug)}
                style={{
                  fontSize: 12, fontWeight: 600, padding: "7px 13px", borderRadius: 999,
                  cursor: "pointer",
                  border: `1px solid ${active ? C.espresso : C.hairline}`,
                  background: active ? C.espresso : "#FFFFFF",
                  color: active ? "#FFFFFF" : C.coffee,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Find My Braider — AI Style-Match */}
        {!matchResult && (
          <div style={{
            background: C.ivory, border: `1px solid ${C.hairline}`, borderRadius: 16,
            padding: 14, marginBottom: 18,
          }}>
            <button
              type="button"
              onClick={() => setMatchOpen(o => !o)}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 10, background: "transparent", border: 0, cursor: "pointer", padding: 0, textAlign: "left",
              }}
            >
              <span>
                <span style={{ display: "block", fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: C.espresso }}>
                  ✦ Find My Braider
                </span>
                <span style={{ display: "block", fontSize: 12, color: C.muted, marginTop: 2 }}>
                  Have a style in mind? Upload a photo and we&apos;ll match you.
                </span>
              </span>
              <span style={{ color: C.goldDeep, fontWeight: 700, fontSize: 13 }}>{matchOpen ? "▴" : "▾"}</span>
            </button>

            {matchOpen && (
              <div style={{ marginTop: 12 }}>
                <label style={{
                  display: "block", border: `1px dashed ${C.hairline}`, borderRadius: 12,
                  padding: photoPreview ? 8 : 18, textAlign: "center", cursor: "pointer", background: "#FFFFFF",
                }}>
                  <input type="file" accept="image/*" onChange={onPhotoPick} style={{ display: "none" }} />
                  {photoPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoPreview} alt="" style={{ maxHeight: 160, borderRadius: 8, objectFit: "contain", margin: "0 auto" }} />
                  ) : (
                    <span style={{ fontSize: 13, color: C.coffee, fontWeight: 600 }}>📷 Tap to add an inspiration photo</span>
                  )}
                </label>
                <input
                  type="text"
                  value={matchNotes}
                  onChange={e => setMatchNotes(e.target.value)}
                  placeholder="Anything else? (color, length, occasion — optional)"
                  style={{
                    width: "100%", marginTop: 10, padding: "10px 12px", fontSize: 13,
                    borderRadius: 10, border: `1px solid ${C.hairline}`, background: "#FFFFFF",
                    color: C.espresso, outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={() => void runMatch()}
                  disabled={matchBusy || !photoData}
                  style={{
                    width: "100%", marginTop: 10, padding: "12px 18px", fontSize: 14, fontWeight: 700,
                    borderRadius: 12, border: 0, cursor: matchBusy || !photoData ? "default" : "pointer",
                    background: matchBusy || !photoData ? C.hairline : C.espresso,
                    color: "#FFFFFF", letterSpacing: "0.03em",
                  }}
                >
                  {matchBusy ? "Matching your style…" : "Find my matches"}
                </button>
                {matchErr && (
                  <p style={{ fontSize: 12, color: "#9C3D2E", margin: "8px 0 0", textAlign: "center" }}>{matchErr}</p>
                )}
                {query.trim() && (
                  <p style={{ fontSize: 11, color: C.muted, margin: "8px 0 0", textAlign: "center" }}>
                    Matching near “{query.trim()}”. Clear the city box to search everywhere.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {matchResult ? (
          <>
            <div style={{
              background: C.ivory, border: `1px solid ${C.hairline}`, borderRadius: 16,
              padding: 14, marginBottom: 16,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <p style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600, color: C.espresso, margin: 0 }}>
                  {matchResult.detected.styleFamily
                    ? `We spotted ${matchResult.detected.styleFamily}`
                    : "Your style match"}
                </p>
                <button
                  type="button"
                  onClick={clearMatch}
                  style={{ background: "transparent", border: 0, color: C.goldDeep, fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  ✕ Clear
                </button>
              </div>
              {matchResult.detected.rationale && (
                <p style={{ fontSize: 13, color: C.coffee, margin: "6px 0 0", lineHeight: 1.5 }}>
                  {matchResult.detected.rationale}
                </p>
              )}
              {matchResult.detected.styleTags.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {matchResult.detected.styleTags.map(tag => (
                    <span key={tag} style={{
                      fontSize: 11, fontWeight: 700, color: C.goldDeep, background: "#FFFFFF",
                      border: `1px solid ${C.hairline}`, borderRadius: 999, padding: "3px 9px",
                    }}>
                      {styleLabel(tag)}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {matchResult.matches.length > 0 ? (
              <>
                <p style={{ fontSize: 12, color: C.muted, margin: "0 0 10px" }}>
                  {matchResult.matches.length} matching braider{matchResult.matches.length === 1 ? "" : "s"}
                  {query.trim() ? ` near “${query.trim()}”` : ""}
                </p>
                {matchResult.matches.map(s => <StylistCard key={s.slug} s={s} />)}
              </>
            ) : (
              <div style={{ textAlign: "center", padding: "24px 12px" }}>
                <p style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600, color: C.espresso, margin: 0 }}>
                  {matchResult.detected.styleTags.length === 0
                    ? "Hmm, we couldn't pin down that style"
                    : "No braiders match that style yet"}
                </p>
                <p style={{ fontSize: 13, color: C.muted, margin: "8px 0 0", lineHeight: 1.5 }}>
                  {query.trim()
                    ? "Try clearing the city to search everywhere, or browse all braiders."
                    : "Browse all braiders below instead."}
                </p>
                <button
                  type="button"
                  onClick={clearMatch}
                  style={{
                    marginTop: 14, padding: "10px 18px", fontSize: 13, fontWeight: 600,
                    borderRadius: 999, border: `1px solid ${C.hairline}`, background: "transparent", color: C.espresso,
                  }}
                >
                  Browse all braiders
                </button>
              </div>
            )}
          </>
        ) : loading ? (
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
                onClick={() => { setQuery(""); setSubmitted(""); setStyle(null); setMobileOnly(false); void run("", null, false); }}
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
          Are you a braider? <Link href="/" style={{ color: C.goldDeep, fontWeight: 600 }}>Get Braid Boss Pro</Link> to get listed.
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
