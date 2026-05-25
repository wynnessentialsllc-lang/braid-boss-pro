// Side-by-side comparison of Braid Boss Pro vs. the platforms most
// braiders are switching from. Static; rendered on the server.
// Marks are intentionally honest:
//   ✓  full support
//   ~  partial / add-on / limited
//   —  not supported
// Public-plan facing as of 2026; revisit when competitors change tiers.

import { C, FONT_DISPLAY, SHADOWS } from "./tokens";

type Cell = "yes" | "partial" | "no" | string;

type Row = {
  feature: string;
  detail?: string;
  bbp: Cell;
  booksy: Cell;
  styleseat: Cell;
  glossgenius: Cell;
  vagaro: Cell;
};

const ROWS: Row[] = [
  { feature: "Monthly subscription", bbp: "$0 (one-time $9.99)", booksy: "$29.99+/mo", styleseat: "$35/mo", glossgenius: "$48/mo", vagaro: "$30+/mo" },
  { feature: "New-client booking fee", detail: "% of ticket on marketplace bookings", bbp: "no", booksy: "20%", styleseat: "30%", glossgenius: "no", vagaro: "$1 flat" },
  { feature: "Branded booking page", bbp: "yes", booksy: "partial", styleseat: "partial", glossgenius: "yes", vagaro: "yes" },
  { feature: "Stripe Connect direct payouts", detail: "Funds land in your bank, not the platform's", bbp: "yes", booksy: "no", styleseat: "no", glossgenius: "no", vagaro: "no" },
  { feature: "Braiding-specific client notes", detail: "Scalp sensitivity, allergies, preferred styles", bbp: "yes", booksy: "no", styleseat: "no", glossgenius: "partial", vagaro: "partial" },
  { feature: "Contracts + e-sign at booking", bbp: "yes", booksy: "no", styleseat: "no", glossgenius: "partial", vagaro: "yes" },
  { feature: "Annual tax pack export", bbp: "yes", booksy: "no", styleseat: "no", glossgenius: "partial", vagaro: "yes" },
  { feature: "Retail storefront + inventory", bbp: "yes", booksy: "partial", styleseat: "no", glossgenius: "yes", vagaro: "yes" },
  { feature: "Gift cards · loyalty · referrals", bbp: "yes", booksy: "yes", styleseat: "partial", glossgenius: "yes", vagaro: "yes" },
  { feature: "Marketing campaigns (SMS + email)", bbp: "yes", booksy: "yes", styleseat: "partial", glossgenius: "yes", vagaro: "yes" },
  { feature: "iOS native + installable PWA", bbp: "yes", booksy: "yes", styleseat: "yes", glossgenius: "yes", vagaro: "yes" },
  { feature: "CSV import from competitors", detail: "Booksy / StyleSeat / Vagaro / Square auto-mapped", bbp: "yes", booksy: "no", styleseat: "no", glossgenius: "partial", vagaro: "partial" },
];

type Col = { key: "bbp" | "booksy" | "styleseat" | "glossgenius" | "vagaro"; label: string; highlight?: boolean };
const COLS: Col[] = [
  { key: "bbp",         label: "Braid Boss Pro", highlight: true },
  { key: "booksy",      label: "Booksy" },
  { key: "styleseat",   label: "StyleSeat" },
  { key: "glossgenius", label: "GlossGenius" },
  { key: "vagaro",      label: "Vagaro" },
];

const Mark = ({ value, highlight }: { value: Cell; highlight?: boolean }) => {
  if (value === "yes") {
    return <span aria-label="Included" style={{ color: highlight ? "#16A34A" : "#16A34A", fontWeight: 800 }}>✓</span>;
  }
  if (value === "no") {
    return <span aria-label="Not included" style={{ color: C.muted }}>—</span>;
  }
  if (value === "partial") {
    return <span aria-label="Partial support" style={{ color: "#D97706", fontWeight: 700 }}>~</span>;
  }
  return <span style={{ fontSize: 12, color: highlight ? C.brandPrimaryDeep : C.coffee, fontWeight: highlight ? 700 : 500 }}>{value}</span>;
};

export default function CompetitorTable() {
  return (
    <div
      style={{
        background: C.paper,
        border: `1px solid ${C.brandBorder}`,
        borderRadius: 24,
        overflow: "hidden",
        boxShadow: SHADOWS.card,
      }}
    >
      <div style={{ padding: "22px 22px 6px" }}>
        <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: C.brandPrimaryDeep }}>
          Side-by-side
        </p>
        <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 700, color: C.ink, margin: "6px 0 0", lineHeight: 1.1 }}>
          Braid Boss Pro vs. the platform you&apos;re leaving.
        </h3>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 720, fontSize: 13.5 }}>
          <thead>
            <tr style={{ background: C.brandSurface }}>
              <th style={{ textAlign: "left", padding: "12px 18px", fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: C.muted }}>
                Feature
              </th>
              {COLS.map(c => (
                <th
                  key={c.key}
                  style={{
                    textAlign: "center",
                    padding: "12px 14px",
                    fontSize: 12,
                    fontWeight: 800,
                    color: c.highlight ? C.brandPrimaryDeep : C.ink,
                    background: c.highlight ? "rgba(124, 58, 237, 0.08)" : undefined,
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r, i) => (
              <tr key={r.feature} style={{ borderTop: `1px solid ${C.brandBorder}`, background: i % 2 === 1 ? C.brandSurface : "transparent" }}>
                <td style={{ padding: "12px 18px", color: C.ink, fontWeight: 600 }}>
                  {r.feature}
                  {r.detail && <div style={{ fontSize: 11.5, color: C.muted, fontWeight: 500, marginTop: 2 }}>{r.detail}</div>}
                </td>
                {COLS.map(c => (
                  <td
                    key={c.key}
                    style={{
                      textAlign: "center",
                      padding: "12px 14px",
                      background: c.highlight ? "rgba(124, 58, 237, 0.06)" : undefined,
                    }}
                  >
                    <Mark value={r[c.key]} highlight={c.highlight} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ padding: "12px 22px 18px", margin: 0, fontSize: 11.5, color: C.muted }}>
        Public-plan information as of 2026. Competitor pricing changes — always confirm on their site before switching.
      </p>
    </div>
  );
}
