"use client";

// Reviews block shown on a public video / class detail page. Purely
// presentational — the caller fetches via fetchVideoReviews /
// fetchClassReviews (both already toggle-gated server-side, so an empty
// list here also covers a braider who turned reviews off).

import { C, FONT_DISPLAY } from "./StorefrontShell";
import type { AcademyReview } from "../../../lib/academy";

const Stars = ({ n, size = 13 }: { n: number; size?: number }) => (
  <span style={{ fontSize: size, letterSpacing: "0.05em", lineHeight: 1 }}>
    <span style={{ color: C.brandPrimary }}>{"★".repeat(Math.max(0, Math.min(5, n)))}</span>
    <span style={{ color: C.brandBorder }}>{"★".repeat(Math.max(0, 5 - n))}</span>
  </span>
);

export function AcademyReviews({ reviews, noun }: { reviews: AcademyReview[]; noun: string }) {
  if (!reviews.length) return null;
  const avg = reviews.reduce((s, r) => s + r.stars, 0) / reviews.length;
  return (
    <section className="mt-8">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 700, color: C.brandText }}>
          What students say
        </h2>
        <Stars n={Math.round(avg)} size={15} />
        <span className="text-[13px]" style={{ color: C.muted }}>
          {avg.toFixed(1)} · {reviews.length} review{reviews.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="space-y-3">
        {reviews.map((r, i) => (
          <div key={i} className="rounded-xl p-3.5" style={{ background: C.paper, border: `1px solid ${C.brandBorder}` }}>
            <div className="flex items-center justify-between gap-2">
              <Stars n={r.stars} />
              <span className="text-[12px] truncate" style={{ color: C.mutedSoft }}>
                {r.display_name || `${noun} buyer`}
              </span>
            </div>
            {r.notes?.trim() && (
              <p className="text-[14px] mt-2 whitespace-pre-wrap" style={{ color: C.coffee, lineHeight: 1.55 }}>
                {r.notes.trim()}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
