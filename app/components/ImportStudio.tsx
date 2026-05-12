"use client";

// Guided studio-data migration flow.
//
// Six-step wizard inside the existing Sheet primitive:
//   1. upload    — pick a CSV (drag/drop or tap)
//   2. detect    — auto-detect target table from headers; show counts
//   3. map       — manual override for any auto-mapped field
//   4. preview   — first 10 rows color-coded: valid / duplicate / error
//   5. summary   — counts of "to create" vs "skipped" before commit
//   6. complete  — luxury success screen with CTAs into the relevant tab
//
// Duplicate detection runs against the live `store.clients` and
// `store.servicesApi.services` arrays so we never silently overwrite.
// Match keys:
//   clients  → email, phone, normalized name
//   services → normalized name
//
// XLSX is intentionally not supported (would need sheetjs, +600KB).
// Appointments import is out of scope (needs client-id resolution).

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronRight,
  Sparkles,
  FileText,
  Download,
} from "lucide-react";
import { parseCsv, buildCsv, pickField } from "../lib/csv";
import { downloadCsv } from "../lib/native-download";
import { trackEvent } from "../lib/track";

// =====================================================================
// Palette — mirrors C in app/page.tsx so this component is portable.
// =====================================================================
const C = {
  cream: "#FAF5EC",
  ivory: "#F5EBD9",
  paper: "#FFFBF2",
  espresso: "#2A1810",
  coffee: "#4A2C1A",
  caramel: "#8B5A2B",
  gold: "#C9A961",
  goldDeep: "#A8893F",
  goldSoft: "#F5E9C8",
  muted: "#8B7355",
  hairline: "rgba(74, 44, 26, 0.12)",
  hairlineSoft: "rgba(74, 44, 26, 0.06)",
  success: "#5C7C4A",
  successSoft: "rgba(92, 124, 74, 0.10)",
  warning: "#C9762B",
  warningSoft: "rgba(201, 118, 43, 0.10)",
  danger: "#9C3D2E",
  dangerSoft: "rgba(156, 61, 46, 0.08)",
} as const;
const FONT_DISPLAY = "'Cormorant Garamond', 'Playfair Display', Georgia, serif";

// =====================================================================
// Target schemas — drives auto-mapping, validation, and mapping UI.
// =====================================================================
type ImportTarget = "clients" | "services" | "unknown";

type FieldDef = {
  key: string;            // canonical field on the destination record
  label: string;          // human label
  aliases: string[];      // normalized source headers that auto-map to this field
  required?: boolean;
};

const CLIENTS_FIELDS: FieldDef[] = [
  { key: "name", label: "Full name", aliases: ["name", "fullname", "clientname", "firstname"], required: true },
  { key: "phone", label: "Phone", aliases: ["phone", "mobile", "cell", "phonenumber"] },
  { key: "email", label: "Email", aliases: ["email", "emailaddress"] },
  { key: "preferredStyles", label: "Preferred styles", aliases: ["preferredstyles", "styles", "preferred"] },
  { key: "notes", label: "Notes", aliases: ["notes", "note", "comments"] },
  { key: "tags", label: "Tags", aliases: ["tags", "labels"] },
];

const SERVICES_FIELDS: FieldDef[] = [
  { key: "name", label: "Service name", aliases: ["name", "service", "servicename", "title"], required: true },
  { key: "duration_hours", label: "Duration (hours)", aliases: ["durationhours", "duration", "hours"] },
  { key: "base_price", label: "Base price", aliases: ["baseprice", "price", "cost"] },
  { key: "deposit_required", label: "Deposit required", aliases: ["depositrequired"] },
  { key: "deposit_amount", label: "Deposit amount", aliases: ["depositamount", "deposit"] },
  { key: "prep_instructions", label: "Prep instructions", aliases: ["prepinstructions", "prep"] },
  { key: "is_active", label: "Active", aliases: ["isactive", "active"] },
];

// =====================================================================
// Helpers
// =====================================================================
const norm = (s: string): string => s.toLowerCase().replace(/[\s_-]+/g, "");
const normalizeName = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");
const normalizePhone = (s: string): string => s.replace(/\D/g, "");
const normalizeEmail = (s: string): string => s.trim().toLowerCase();

const detectTarget = (headers: string[]): ImportTarget => {
  const set = new Set(headers.map(norm));
  if (set.has("durationhours") || set.has("baseprice") || set.has("price")) return "services";
  if (set.has("phone") || set.has("email") || set.has("name") || set.has("clientname") || set.has("fullname")) return "clients";
  return "unknown";
};

// Build the initial auto-mapping. Returns Record<canonicalKey, sourceHeader>.
const autoMap = (
  headers: string[],
  fields: FieldDef[],
): Record<string, string> => {
  const out: Record<string, string> = {};
  const normHeaders = headers.map((h) => ({ raw: h, n: norm(h) }));
  for (const f of fields) {
    const hit = normHeaders.find((h) => f.aliases.includes(h.n));
    if (hit) out[f.key] = hit.raw;
  }
  return out;
};

type RowStatus = "valid" | "duplicate" | "error";
type RowEval = {
  index: number;
  status: RowStatus;
  reason?: string;
  mapped: Record<string, string>;
  sourceRow: Record<string, string>;
};

const evaluateRows = (
  rows: Record<string, string>[],
  fields: FieldDef[],
  mapping: Record<string, string>,
  target: ImportTarget,
  existing: { clientEmails: Set<string>; clientPhones: Set<string>; clientNames: Set<string>; serviceNames: Set<string> },
): RowEval[] => {
  const required = fields.filter((f) => f.required).map((f) => f.key);
  return rows.map((r, i) => {
    const mapped: Record<string, string> = {};
    for (const f of fields) {
      const src = mapping[f.key];
      mapped[f.key] = src ? (r[src] || "").trim() : "";
    }
    for (const k of required) {
      if (!mapped[k]) {
        return { index: i, status: "error" as const, reason: "Missing required field", mapped, sourceRow: r };
      }
    }
    if (target === "clients") {
      const e = normalizeEmail(mapped.email);
      const p = normalizePhone(mapped.phone);
      const n = normalizeName(mapped.name);
      if (e && existing.clientEmails.has(e)) return { index: i, status: "duplicate" as const, reason: "Existing email", mapped, sourceRow: r };
      if (p && p.length >= 7 && existing.clientPhones.has(p)) return { index: i, status: "duplicate" as const, reason: "Existing phone", mapped, sourceRow: r };
      if (n && existing.clientNames.has(n)) return { index: i, status: "duplicate" as const, reason: "Existing name", mapped, sourceRow: r };
    } else if (target === "services") {
      const n = normalizeName(mapped.name);
      if (n && existing.serviceNames.has(n)) return { index: i, status: "duplicate" as const, reason: "Existing service", mapped, sourceRow: r };
    }
    return { index: i, status: "valid" as const, mapped, sourceRow: r };
  });
};

// =====================================================================
// Sample template downloads
// =====================================================================
const CLIENTS_TEMPLATE = buildCsv(
  [
    { name: "Amara Johnson", phone: "555-204-1839", email: "amara@example.com", preferred_styles: "Knotless, Boho", notes: "Sensitive scalp", tags: "VIP" },
    { name: "Jasmine Carter", phone: "555-991-3320", email: "jasmine@example.com", preferred_styles: "Box braids", notes: "", tags: "Repeat" },
  ],
  ["name", "phone", "email", "preferred_styles", "notes", "tags"],
);

const SERVICES_TEMPLATE = buildCsv(
  [
    { name: "Knotless braids — Medium", duration_hours: 5, base_price: 220, deposit_required: true, deposit_amount: 50, prep_instructions: "Wash + blow-dry", is_active: true },
    { name: "Box braids — Waist length", duration_hours: 7, base_price: 320, deposit_required: true, deposit_amount: 75, prep_instructions: "Wash + blow-dry", is_active: true },
  ],
  ["name", "duration_hours", "base_price", "deposit_required", "deposit_amount", "prep_instructions", "is_active"],
);

// =====================================================================
// Small inline presentation helpers
// =====================================================================
const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: C.goldDeep }}>
    {children}
  </p>
);
const StepDots = ({ step }: { step: number }) => (
  <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 14 }}>
    {[1, 2, 3, 4, 5, 6].map((i) => (
      <span
        key={i}
        style={{
          width: i === step ? 22 : 6,
          height: 6,
          borderRadius: 99,
          background: i <= step ? C.goldDeep : C.hairline,
          transition: "width 240ms ease, background 240ms ease",
        }}
      />
    ))}
  </div>
);

const StatusDot = ({ status }: { status: RowStatus }) => {
  const map = {
    valid: C.success,
    duplicate: C.gold,
    error: C.danger,
  };
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: 99,
        background: map[status],
        flexShrink: 0,
      }}
    />
  );
};

// =====================================================================
// Main component
// =====================================================================
type ImportStudioProps = {
  store: any;
  onClose: () => void;
  onViewClients?: () => void;
  onViewServices?: () => void;
};

type Step = 1 | 2 | 3 | 4 | 5 | 6;

const ImportStudio = ({ store, onClose, onViewClients, onViewServices }: ImportStudioProps) => {
  const [step, setStep] = useState<Step>(1);
  const [fileName, setFileName] = useState<string>("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [target, setTarget] = useState<ImportTarget>("unknown");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{
    created: number;
    duplicates: number;
    invalid: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Existing-record indices for duplicate detection. Built once per
  // step-2 entry so we don't re-allocate on every keystroke.
  const existing = useMemo(() => {
    const clientEmails = new Set<string>();
    const clientPhones = new Set<string>();
    const clientNames = new Set<string>();
    const serviceNames = new Set<string>();
    for (const c of (store?.clients || []) as any[]) {
      if (c?.email) clientEmails.add(normalizeEmail(String(c.email)));
      if (c?.phone) {
        const p = normalizePhone(String(c.phone));
        if (p.length >= 7) clientPhones.add(p);
      }
      if (c?.name) clientNames.add(normalizeName(String(c.name)));
    }
    for (const s of (store?.servicesApi?.services || []) as any[]) {
      if (s?.name) serviceNames.add(normalizeName(String(s.name)));
    }
    return { clientEmails, clientPhones, clientNames, serviceNames };
  }, [store?.clients, store?.servicesApi?.services]);

  const fields = target === "services" ? SERVICES_FIELDS : CLIENTS_FIELDS;

  const evaluations = useMemo<RowEval[]>(() => {
    if (rows.length === 0 || target === "unknown") return [];
    return evaluateRows(rows, fields, mapping, target, existing);
  }, [rows, fields, mapping, target, existing]);

  const counts = useMemo(() => {
    let valid = 0, duplicate = 0, error = 0;
    for (const e of evaluations) {
      if (e.status === "valid") valid++;
      else if (e.status === "duplicate") duplicate++;
      else error++;
    }
    return { valid, duplicate, error };
  }, [evaluations]);

  const reset = () => {
    setStep(1); setFileName(""); setHeaders([]); setRows([]);
    setTarget("unknown"); setMapping({}); setBusy(false);
    setErr(null); setResult(null);
  };
  const close = () => { reset(); onClose(); };

  // ----- Step transitions -----
  const handleFile = async (f: File) => {
    setErr(null);
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") {
      setErr("Only CSV files are supported in this beta. XLSX coming soon.");
      trackEvent("import_failed", { category: "error", metadata: { reason: "unsupported_type" } });
      return;
    }
    try {
      const text = await f.text();
      const parsed = parseCsv(text);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setErr("That file looks empty or unreadable.");
        trackEvent("import_failed", { category: "error", metadata: { reason: "empty" } });
        return;
      }
      const detected = detectTarget(parsed.headers);
      const auto = autoMap(parsed.headers, detected === "services" ? SERVICES_FIELDS : CLIENTS_FIELDS);
      setFileName(f.name);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setTarget(detected);
      setMapping(auto);
      setStep(2);
      trackEvent("import_started", { category: "feature", metadata: { rows: parsed.rows.length, headers: parsed.headers.length, target: detected, file_type: "csv" } });
    } catch (e: any) {
      setErr(e?.message || "Couldn't read that file.");
      trackEvent("import_failed", { category: "error", metadata: { reason: "parse" } });
    }
  };

  const goToMap = () => setStep(3);
  const goToPreview = () => {
    trackEvent("import_mapping_completed", { category: "feature", metadata: { target } });
    setStep(4);
  };
  const goToSummary = () => {
    trackEvent("import_preview_viewed", { category: "feature", metadata: { target, valid: counts.valid, duplicate: counts.duplicate, error: counts.error } });
    setStep(5);
  };

  const commit = async () => {
    setBusy(true);
    setErr(null);
    let created = 0;
    let duplicates = 0;
    let invalid = 0;
    try {
      if (target === "clients") {
        for (const ev of evaluations) {
          if (ev.status === "duplicate") { duplicates++; continue; }
          if (ev.status === "error") { invalid++; continue; }
          try {
            await store.upsertClient({
              name: ev.mapped.name,
              phone: ev.mapped.phone || undefined,
              email: ev.mapped.email || undefined,
              notes: ev.mapped.notes || undefined,
              preferredStyles: ev.mapped.preferredStyles || undefined,
              tags: ev.mapped.tags
                ? ev.mapped.tags.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
                : undefined,
            });
            created++;
          } catch { invalid++; }
        }
      } else if (target === "services") {
        const api = store.servicesApi;
        if (!api?.upsert) throw new Error("Services API unavailable.");
        for (const ev of evaluations) {
          if (ev.status === "duplicate") { duplicates++; continue; }
          if (ev.status === "error") { invalid++; continue; }
          const dur = parseFloat(ev.mapped.duration_hours || "0");
          const price = parseFloat(ev.mapped.base_price || "0");
          const depReq = /^(true|yes|y|1)$/i.test(ev.mapped.deposit_required || "");
          const depAmt = parseFloat(ev.mapped.deposit_amount || "0");
          const active = !/^(false|no|n|0)$/i.test(ev.mapped.is_active || "true");
          try {
            await api.upsert({
              name: ev.mapped.name,
              duration_hours: Number.isFinite(dur) && dur > 0 ? dur : 1,
              base_price: Number.isFinite(price) ? price : 0,
              deposit_required: depReq,
              deposit_amount: Number.isFinite(depAmt) ? depAmt : 0,
              prep_instructions: ev.mapped.prep_instructions || null,
              is_active: active,
            });
            created++;
          } catch { invalid++; }
        }
      }
      setResult({ created, duplicates, invalid });
      setStep(6);
      trackEvent("import_completed", { category: "feature", metadata: { target, created, duplicates, invalid } });
    } catch (e: any) {
      setErr(e?.message || "Couldn't import that file.");
      trackEvent("import_failed", { category: "error", metadata: { reason: "commit", target } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ paddingTop: 4 }}>
      <StepDots step={step} />

      {/* ============================================================
          Step 1 — Upload
          ============================================================ */}
      {step === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <Eyebrow>Step 1 · Upload</Eyebrow>
            <h2 style={{ margin: "6px 0 4px", fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600, color: C.espresso, lineHeight: 1.1 }}>
              Bring your studio in.
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: C.muted, lineHeight: 1.55 }}>
              Switching apps shouldn&apos;t mean starting over. Upload a CSV of your clients or services and we&apos;ll guide you the rest of the way.
            </p>
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              appearance: "none",
              WebkitAppearance: "none",
              border: `1.5px dashed ${C.caramel}`,
              background: C.cream,
              borderRadius: 18,
              padding: "26px 18px",
              textAlign: "center",
              cursor: "pointer",
              color: "inherit",
              font: "inherit",
            }}
          >
            <div style={{ pointerEvents: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <div style={{ width: 44, height: 44, borderRadius: 99, background: C.gold, color: C.espresso, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Upload size={20} />
              </div>
              <p style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: C.espresso }}>
                Tap to upload a CSV
              </p>
              <p style={{ margin: 0, fontSize: 11.5, color: C.muted }}>
                .csv files supported · clients or services
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = "";
              }}
            />
          </button>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: C.muted }}>
              Sample templates
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button
                type="button"
                onClick={() => void downloadCsv("braid-boss-pro-clients-template.csv", CLIENTS_TEMPLATE)}
                style={sampleBtn}
              >
                <Download size={13} /> Clients
              </button>
              <button
                type="button"
                onClick={() => void downloadCsv("braid-boss-pro-services-template.csv", SERVICES_TEMPLATE)}
                style={sampleBtn}
              >
                <Download size={13} /> Services
              </button>
            </div>
          </div>

          {err && <p style={{ margin: 0, fontSize: 12, color: C.danger }}>{err}</p>}
        </div>
      )}

      {/* ============================================================
          Step 2 — Detect
          ============================================================ */}
      {step === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <Eyebrow>Step 2 · Detect</Eyebrow>
            <h2 style={{ margin: "6px 0 4px", fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600, color: C.espresso, lineHeight: 1.1 }}>
              {target === "clients" ? `We found ${rows.length} client${rows.length === 1 ? "" : "s"}.`
                : target === "services" ? `We found ${rows.length} service${rows.length === 1 ? "" : "s"}.`
                : "We couldn't recognize this file."}
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: C.muted, lineHeight: 1.55 }}>
              {target === "unknown"
                ? "Make sure your file has columns like name, phone, email (for clients) or name, duration_hours, base_price (for services)."
                : "Next, you'll confirm how we mapped your columns. You can adjust anything we got wrong."}
            </p>
          </div>

          <div style={summaryCard}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <FileText size={20} style={{ color: C.goldDeep, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.espresso, lineHeight: 1.2 }}>
                  {fileName}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: C.muted }}>
                  {headers.length} column{headers.length === 1 ? "" : "s"} · {rows.length} row{rows.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          </div>

          {target !== "unknown" && (
            <button type="button" onClick={goToMap} style={primaryBtn}>
              Continue · review mapping <ChevronRight size={16} />
            </button>
          )}
          <button type="button" onClick={reset} style={secondaryBtn}>
            Pick a different file
          </button>
        </div>
      )}

      {/* ============================================================
          Step 3 — Mapping
          ============================================================ */}
      {step === 3 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <Eyebrow>Step 3 · Match columns</Eyebrow>
            <h2 style={{ margin: "6px 0 4px", fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600, color: C.espresso, lineHeight: 1.1 }}>
              Tell us what&apos;s what.
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: C.muted, lineHeight: 1.55 }}>
              We&apos;ve auto-matched the obvious ones. Adjust any field that should pull from a different column.
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {fields.map((f) => {
              const matched = mapping[f.key] || "";
              const isMissingRequired = f.required && !matched;
              return (
                <div key={f.key} style={{
                  background: C.paper,
                  border: `1px solid ${isMissingRequired ? C.danger : C.hairline}`,
                  borderRadius: 14,
                  padding: 12,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: C.espresso }}>
                      {f.label}
                      {f.required && <span style={{ color: C.gold, marginLeft: 4 }}>*</span>}
                    </p>
                    {matched && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: C.success, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                        Auto-matched
                      </span>
                    )}
                  </div>
                  <select
                    value={matched}
                    onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                    style={selectStyle}
                  >
                    <option value="">— Don&apos;t import —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          {fields.some((f) => f.required && !mapping[f.key]) && (
            <p style={{ margin: 0, fontSize: 12, color: C.danger }}>
              Required fields ({fields.filter((f) => f.required).map((f) => f.label).join(", ")}) must be mapped.
            </p>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button type="button" onClick={() => setStep(2)} style={secondaryBtn}>Back</button>
            <button
              type="button"
              onClick={goToPreview}
              disabled={fields.some((f) => f.required && !mapping[f.key])}
              style={{ ...primaryBtn, opacity: fields.some((f) => f.required && !mapping[f.key]) ? 0.5 : 1 }}
            >
              Preview <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          Step 4 — Preview
          ============================================================ */}
      {step === 4 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <Eyebrow>Step 4 · Preview</Eyebrow>
            <h2 style={{ margin: "6px 0 4px", fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600, color: C.espresso, lineHeight: 1.1 }}>
              How it looks.
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: C.muted, lineHeight: 1.55 }}>
              First {Math.min(10, evaluations.length)} rows. We&apos;ll never overwrite an existing record — duplicates are skipped automatically.
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Tally tone="success" label="Valid" n={counts.valid} />
            <Tally tone="gold" label="Duplicate" n={counts.duplicate} />
            <Tally tone="danger" label="Issue" n={counts.error} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {evaluations.slice(0, 10).map((ev) => {
              const titleField = ev.mapped.name || "—";
              const sub = target === "clients"
                ? [ev.mapped.email, ev.mapped.phone].filter(Boolean).join(" · ")
                : [ev.mapped.duration_hours && `${ev.mapped.duration_hours}h`, ev.mapped.base_price && `$${ev.mapped.base_price}`].filter(Boolean).join(" · ");
              const bg = ev.status === "valid" ? C.successSoft : ev.status === "duplicate" ? C.warningSoft : C.dangerSoft;
              const border = ev.status === "valid" ? C.success : ev.status === "duplicate" ? C.gold : C.danger;
              return (
                <div key={ev.index} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                  <StatusDot status={ev.status} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.espresso, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {titleField}
                    </p>
                    <p style={{ margin: "1px 0 0", fontSize: 11, color: C.muted }}>
                      {ev.reason || sub || `Row ${ev.index + 1}`}
                    </p>
                  </div>
                </div>
              );
            })}
            {evaluations.length > 10 && (
              <p style={{ margin: "4px 0 0", fontSize: 11, color: C.muted, textAlign: "center" }}>
                +{evaluations.length - 10} more row{evaluations.length - 10 === 1 ? "" : "s"}
              </p>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button type="button" onClick={() => setStep(3)} style={secondaryBtn}>Back to mapping</button>
            <button
              type="button"
              onClick={goToSummary}
              disabled={counts.valid === 0}
              style={{ ...primaryBtn, opacity: counts.valid === 0 ? 0.5 : 1 }}
            >
              Continue <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          Step 5 — Summary
          ============================================================ */}
      {step === 5 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <Eyebrow>Step 5 · Confirm</Eyebrow>
            <h2 style={{ margin: "6px 0 4px", fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600, color: C.espresso, lineHeight: 1.1 }}>
              Ready to bring it all in.
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: C.muted, lineHeight: 1.55 }}>
              Last look before we save anything. Nothing existing will be overwritten.
            </p>
          </div>

          <div style={summaryCard}>
            <SummaryRow label={target === "clients" ? "Clients to create" : "Services to create"} value={counts.valid} accent />
            <SummaryRow label="Duplicates skipped" value={counts.duplicate} />
            <SummaryRow label="Invalid rows skipped" value={counts.error} />
          </div>

          {err && <p style={{ margin: 0, fontSize: 12, color: C.danger }}>{err}</p>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button type="button" onClick={() => setStep(4)} style={secondaryBtn} disabled={busy}>Back</button>
            <button type="button" onClick={commit} disabled={busy || counts.valid === 0} style={{ ...primaryBtn, opacity: busy || counts.valid === 0 ? 0.6 : 1 }}>
              {busy ? "Importing…" : `Import ${counts.valid}`}
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          Step 6 — Complete
          ============================================================ */}
      {step === 6 && result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center", textAlign: "center" }}>
          <div style={{
            width: 64, height: 64, borderRadius: 99,
            background: "radial-gradient(circle, rgba(201,169,97,0.32) 0%, rgba(201,169,97,0) 70%)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Sparkles size={32} style={{ color: C.goldDeep }} />
          </div>
          <div>
            <Eyebrow>Complete</Eyebrow>
            <h2 style={{ margin: "6px 0 4px", fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 600, color: C.espresso, lineHeight: 1.05 }}>
              Your studio is ready.
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: C.muted, lineHeight: 1.55 }}>
              Imported into Braid Boss Pro. Everything you brought is safe and ready to use.
            </p>
          </div>

          <div style={{ ...summaryCard, width: "100%" }}>
            <SummaryRow label={target === "clients" ? "Clients imported" : "Services imported"} value={result.created} accent />
            <SummaryRow label="Duplicates skipped" value={result.duplicates} />
            <SummaryRow label="Invalid rows skipped" value={result.invalid} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: target === "clients" ? "1fr" : "1fr", gap: 8, width: "100%" }}>
            {target === "clients" && onViewClients && (
              <button type="button" onClick={() => { onViewClients(); close(); }} style={primaryBtn}>
                View clients
              </button>
            )}
            {target === "services" && onViewServices && (
              <button type="button" onClick={() => { onViewServices(); close(); }} style={primaryBtn}>
                View services
              </button>
            )}
            <button type="button" onClick={close} style={secondaryBtn}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// =====================================================================
// Inline style fragments (kept at the bottom for readability)
// =====================================================================

const primaryBtn: React.CSSProperties = {
  appearance: "none",
  WebkitAppearance: "none",
  border: "none",
  borderRadius: 999,
  padding: "14px 22px",
  background: C.espresso,
  color: C.cream,
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: "0.02em",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: 48,
  width: "100%",
  font: "inherit",
};

const secondaryBtn: React.CSSProperties = {
  appearance: "none",
  WebkitAppearance: "none",
  borderRadius: 999,
  padding: "12px 22px",
  background: "transparent",
  color: C.espresso,
  fontSize: 13,
  fontWeight: 600,
  border: `1px solid ${C.hairline}`,
  cursor: "pointer",
  minHeight: 46,
  width: "100%",
  font: "inherit",
};

const sampleBtn: React.CSSProperties = {
  appearance: "none",
  WebkitAppearance: "none",
  border: `1px solid ${C.hairline}`,
  borderRadius: 12,
  background: C.paper,
  color: C.coffee,
  fontSize: 12,
  fontWeight: 600,
  padding: "10px 12px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  cursor: "pointer",
  font: "inherit",
};

const selectStyle: React.CSSProperties = {
  appearance: "none",
  WebkitAppearance: "none",
  width: "100%",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 13,
  color: C.espresso,
  background: C.cream,
  border: `1px solid ${C.hairline}`,
  font: "inherit",
};

const summaryCard: React.CSSProperties = {
  background: C.paper,
  border: `1px solid ${C.hairline}`,
  borderRadius: 16,
  padding: 16,
  boxShadow: "0 10px 22px -16px rgba(42,24,16,0.22)",
};

const Tally = ({ tone, label, n }: { tone: "success" | "gold" | "danger"; label: string; n: number }) => {
  const bg = tone === "success" ? C.successSoft : tone === "gold" ? C.warningSoft : C.dangerSoft;
  const fg = tone === "success" ? C.success : tone === "gold" ? C.goldDeep : C.danger;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 99, background: bg, color: fg, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
      <span>{label}</span>
      <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo" }}>{n}</span>
    </div>
  );
};

const SummaryRow = ({ label, value, accent }: { label: string; value: number; accent?: boolean }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0", borderBottom: `1px solid ${C.hairlineSoft}` }}>
    <span style={{ fontSize: 13, color: C.coffee }}>{label}</span>
    <span style={{ fontFamily: accent ? FONT_DISPLAY : "ui-monospace, SFMono-Regular, Menlo", fontSize: accent ? 22 : 14, fontWeight: 600, color: accent ? C.goldDeep : C.espresso }}>
      {value.toLocaleString()}
    </span>
  </div>
);

export default ImportStudio;
// Re-export pieces in case external code wants to render the
// "Switching apps shouldn't mean starting over" tagline elsewhere.
export const IMPORT_TAGLINE = "Switching apps shouldn't mean starting over.";

// Suppress unused-warning on icons retained for future steps (no-op).
void CheckCircle2; void AlertTriangle; void XCircle;
