"use client";

// /settings/product-profit — Product Profit Calculator.
//
// Settings → Product Profit Calculator. Helps a product-based beauty
// business cost a finished product, see how many units a bulk purchase
// yields, get smart retail/wholesale pricing for a target margin, and
// forecast revenue + profit (after fees and taxes) and break-even.
//
// All math lives in lib/product-profit.ts (pure, unit-tested). Saved
// products round-trip through lib/product-profit-store.ts → the
// RLS-pinned product_profit_products table. This screen is the view
// layer: form, KPI cards, and a small reporting dashboard.
//
// Mobile-first, card-based, matching the booking/payments palette so the
// visual language carries across the app.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Plus,
  Copy,
  Pencil,
  Archive,
  ArchiveRestore,
  Trash2,
  BarChart3,
  Beaker,
  Package,
  Sparkles,
} from "lucide-react";
import { getSupabase } from "../../lib/supabase";
import {
  blankProduct,
  calculateProduct,
  MARGIN_PRESETS,
  PRODUCT_CATEGORIES,
  rankProducts,
  averageCostPerUnit,
  type CostLine,
  type ProductProfitInput,
  type SavedProduct,
  type SizeUnit,
} from "../../lib/product-profit";
import {
  listProducts,
  saveProduct,
  setArchived,
  deleteProduct,
  newSavedProduct,
  duplicateSavedProduct,
} from "../../lib/product-profit-store";

const C = {
  espresso: "#15111A", coffee: "#3D3447", cream: "#FFFFFF",
  ivory: "#F6F2EC", paper: "#FFFFFF", gold: "#7C3AED", goldDeep: "#5B21B6",
  muted: "#6F6477", hairline: "rgba(21, 17, 26, 0.12)",
  success: "#5C7C4A", warning: "#B8860B", danger: "#9C3D2E",
};
const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;
const FONT_BODY = `"DM Sans", "Inter", system-ui, sans-serif`;

const fmt$ = (n: number | null | undefined): string =>
  n == null ? "—" : `$${(Math.round(n * 100) / 100).toFixed(2)}`;
const fmtPct = (n: number | null | undefined): string =>
  n == null ? "—" : `${Math.round(n)}%`;

type Mode = "list" | "edit" | "report";

export default function ProductProfitPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabase();
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setUserId(data?.session?.user?.id || null);
      setAuthChecked(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const [products, setProducts] = useState<SavedProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("list");
  const [draft, setDraft] = useState<SavedProduct | null>(null);

  const reload = useCallback(async (uid: string) => {
    setLoading(true);
    setError(null);
    try {
      setProducts(await listProducts(uid));
    } catch (e: any) {
      setError(e?.message || "Couldn't load your products.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot load on auth, intentional
    if (userId) void reload(userId);
  }, [userId, reload]);

  const startNew = () => { setDraft(newSavedProduct()); setMode("edit"); };
  const startEdit = (p: SavedProduct) => { setDraft({ ...p }); setMode("edit"); };

  const handleSave = useCallback(async (p: SavedProduct) => {
    if (!userId) return;
    setError(null);
    try {
      await saveProduct(userId, p);
      await reload(userId);
      setMode("list");
      setDraft(null);
    } catch (e: any) {
      setError(e?.message || "Couldn't save. Try again.");
    }
  }, [userId, reload]);

  const handleDuplicate = useCallback(async (p: SavedProduct) => {
    if (!userId) return;
    try {
      await saveProduct(userId, duplicateSavedProduct(p));
      await reload(userId);
    } catch (e: any) {
      setError(e?.message || "Couldn't duplicate.");
    }
  }, [userId, reload]);

  const handleArchive = useCallback(async (p: SavedProduct) => {
    if (!userId) return;
    try {
      await setArchived(userId, p.id, !p.archived);
      await reload(userId);
    } catch (e: any) {
      setError(e?.message || "Couldn't update.");
    }
  }, [userId, reload]);

  const handleDelete = useCallback(async (p: SavedProduct) => {
    if (!userId) return;
    if (typeof window !== "undefined" && !window.confirm(`Delete "${p.name || "this product"}"? This can't be undone.`)) return;
    try {
      await deleteProduct(userId, p.id);
      await reload(userId);
    } catch (e: any) {
      setError(e?.message || "Couldn't delete.");
    }
  }, [userId, reload]);

  if (!authChecked) return <Shell loading />;

  if (!userId) {
    return (
      <Shell>
        <p style={{ fontSize: 14, color: C.coffee, textAlign: "center" }}>
          Sign in to build and save product profit calculations.
        </p>
        <button type="button" onClick={() => router.push("/")} style={primaryButton}>
          Back to app
        </button>
      </Shell>
    );
  }

  if (mode === "edit" && draft) {
    return (
      <ProductEditor
        initial={draft}
        onCancel={() => { setMode("list"); setDraft(null); }}
        onSave={handleSave}
      />
    );
  }

  if (mode === "report") {
    return <ReportDashboard products={products} onBack={() => setMode("list")} />;
  }

  return (
    <Shell
      title="Product Profit"
      onBack={() => router.push("/")}
      headerAction={
        products.length > 0
          ? { icon: <BarChart3 size={18} />, label: "Reports", onClick: () => setMode("report") }
          : undefined
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}

      {products.filter((p) => !p.archived).length > 0 && (
        <SummaryStrip products={products} />
      )}

      <button type="button" onClick={startNew} style={primaryButton}>
        <Plus size={16} style={{ marginRight: 6, verticalAlign: "-2px" }} />
        New product
      </button>

      {loading ? (
        <p style={{ fontSize: 13, color: C.muted, textAlign: "center" }}>Loading…</p>
      ) : products.length === 0 ? (
        <EmptyState onNew={startNew} />
      ) : (
        <ProductList
          products={products}
          onEdit={startEdit}
          onDuplicate={handleDuplicate}
          onArchive={handleArchive}
          onDelete={handleDelete}
        />
      )}
    </Shell>
  );
}

// ---- List + summary ----------------------------------------------------

function SummaryStrip({ products }: { products: SavedProduct[] }) {
  const ranked = useMemo(() => rankProducts(products), [products]);
  const avgCost = useMemo(() => averageCostPerUnit(products), [products]);
  const best = ranked[0];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <MiniStat label="Active products" value={String(ranked.length)} />
      <MiniStat label="Avg cost / unit" value={fmt$(avgCost)} />
      <MiniStat label="Top earner" value={best ? (best.name.length > 14 ? best.name.slice(0, 13) + "…" : best.name) : "—"} />
      <MiniStat label="Best unit profit" value={best ? fmt$(best.unitProfit) : "—"} tone="success" />
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "success" }) {
  return (
    <div style={{ ...cardStyle, padding: 12 }}>
      <p style={labelStyle}>{label}</p>
      <p style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: tone === "success" ? C.success : C.espresso, marginTop: 2 }}>
        {value}
      </p>
    </div>
  );
}

function ProductList({
  products, onEdit, onDuplicate, onArchive, onDelete,
}: {
  products: SavedProduct[];
  onEdit: (p: SavedProduct) => void;
  onDuplicate: (p: SavedProduct) => void;
  onArchive: (p: SavedProduct) => void;
  onDelete: (p: SavedProduct) => void;
}) {
  const active = products.filter((p) => !p.archived);
  const archived = products.filter((p) => p.archived);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {active.map((p) => (
        <ProductCard key={p.id} product={p} onEdit={onEdit} onDuplicate={onDuplicate} onArchive={onArchive} onDelete={onDelete} />
      ))}
      {archived.length > 0 && (
        <>
          <p style={{ ...labelStyle, marginTop: 8 }}>Archived</p>
          {archived.map((p) => (
            <ProductCard key={p.id} product={p} onEdit={onEdit} onDuplicate={onDuplicate} onArchive={onArchive} onDelete={onDelete} />
          ))}
        </>
      )}
    </div>
  );
}

function ProductCard({
  product, onEdit, onDuplicate, onArchive, onDelete,
}: {
  product: SavedProduct;
  onEdit: (p: SavedProduct) => void;
  onDuplicate: (p: SavedProduct) => void;
  onArchive: (p: SavedProduct) => void;
  onDelete: (p: SavedProduct) => void;
}) {
  const m = useMemo(() => calculateProduct(product.input), [product.input]);
  const margin = m.suggestedRetail > 0 ? ((m.suggestedRetail - m.cost.costPerUnit) / m.suggestedRetail) * 100 : null;
  return (
    <div style={{ ...cardStyle, opacity: product.archived ? 0.62 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: C.espresso, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {product.name || "Untitled product"}
          </p>
          <p style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            {product.category} · makes {m.yield.units} {m.yield.units === 1 ? "unit" : "units"}
          </p>
        </div>
        <button type="button" onClick={() => onEdit(product)} style={iconButton} aria-label="Edit">
          <Pencil size={15} />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 12 }}>
        <Stat small label="True cost" value={fmt$(m.cost.costPerUnit)} />
        <Stat small label="Retail" value={fmt$(m.suggestedRetail)} tone="gold" />
        <Stat small label="Margin" value={fmtPct(margin)} tone="success" />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" onClick={() => onDuplicate(product)} style={chip}><Copy size={13} /> Duplicate</button>
        <button type="button" onClick={() => onArchive(product)} style={chip}>
          {product.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
          {product.archived ? "Restore" : "Archive"}
        </button>
        <button type="button" onClick={() => onDelete(product)} style={{ ...chip, color: C.danger }}><Trash2 size={13} /> Delete</button>
      </div>
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div style={{ ...cardStyle, textAlign: "center", padding: 28 }}>
      <div style={{ width: 48, height: 48, borderRadius: 999, margin: "0 auto 12px", display: "grid", placeItems: "center", background: `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`, color: "#fff" }}>
        <Package size={22} />
      </div>
      <p style={{ fontSize: 15, fontWeight: 700, color: C.espresso }}>Price your first product</p>
      <p style={{ fontSize: 12.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
        Enter your bulk cost, packaging, and finished size — we&apos;ll tell you your true cost per unit, smart pricing, and profit.
      </p>
      <button type="button" onClick={onNew} style={{ ...primaryButton, marginTop: 16 }}>
        <Plus size={16} style={{ marginRight: 6, verticalAlign: "-2px" }} /> Create product
      </button>
    </div>
  );
}

// ---- Editor ------------------------------------------------------------

function ProductEditor({
  initial, onCancel, onSave,
}: {
  initial: SavedProduct;
  onCancel: () => void;
  onSave: (p: SavedProduct) => void;
}) {
  const [input, setInput] = useState<ProductProfitInput>({ ...blankProduct(), ...initial.input });
  const [saving, setSaving] = useState(false);
  const set = useCallback(<K extends keyof ProductProfitInput>(key: K, value: ProductProfitInput[K]) => {
    setInput((prev) => ({ ...prev, [key]: value }));
  }, []);
  const setLine = useCallback((key: keyof ProductProfitInput["packaging"], patch: Partial<CostLine>) => {
    setInput((prev) => ({ ...prev, packaging: { ...prev.packaging, [key]: { ...prev.packaging[key], ...patch } } }));
  }, []);

  const m = useMemo(() => calculateProduct(input), [input]);

  const [customMargin, setCustomMargin] = useState(false);

  const submit = () => {
    setSaving(true);
    onSave({
      ...initial,
      name: input.name,
      category: input.category,
      input,
    });
  };

  return (
    <Shell title={initial.updatedAt ? "Edit product" : "New product"} onBack={onCancel}>
      {/* Headline true-cost banner — the number that matters most. */}
      <div style={{ ...cardStyle, background: `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`, border: 0, color: "#fff", textAlign: "center" }}>
        <p style={{ ...labelStyle, color: "rgba(255,255,255,0.8)" }}>True cost per unit</p>
        <p style={{ fontFamily: FONT_DISPLAY, fontSize: 40, fontWeight: 600, lineHeight: 1.05, marginTop: 2 }}>
          {fmt$(m.cost.costPerUnit)}
        </p>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 4 }}>
          {m.yield.units > 0
            ? `Makes ~${m.yield.units} units · batch cost ${fmt$(m.cost.totalBatchCost)}`
            : "Enter bulk & finished size to see your yield"}
        </p>
      </div>

      {/* 1. Product information */}
      <Section title="Product information" icon={<Sparkles size={15} />}>
        <Field label="Product name">
          <TextInput value={input.name} onChange={(v) => set("name", v)} placeholder="e.g. Nourish Oil" />
        </Field>
        <Field label="Category">
          <Select value={input.category} onChange={(v) => set("category", v)} options={PRODUCT_CATEGORIES.map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label="Finished product size">
          <SizeRow value={input.finishedSize} unit={input.finishedUnit} onValue={(v) => set("finishedSize", v)} onUnit={(u) => set("finishedUnit", u)} />
        </Field>
      </Section>

      {/* 2. Bulk product */}
      <Section title="Bulk product" icon={<Package size={15} />}>
        <Field label="Bulk product cost">
          <MoneyInput value={input.bulkCost} onChange={(v) => set("bulkCost", v)} />
        </Field>
        <Field label="Bulk product size">
          <SizeRow value={input.bulkSize} unit={input.bulkUnit} onValue={(v) => set("bulkSize", v)} onUnit={(u) => set("bulkUnit", u)} />
        </Field>
        <CalloutRow label="Total possible units" value={`${m.yield.units}`} hint={m.yield.units > 0 ? "finished products" : "set sizes above"} />
      </Section>

      {/* 3. Dilution */}
      <Section title="Dilution / water" icon={<Beaker size={15} />}
        right={<Toggle checked={input.diluted} onChange={(v) => set("diluted", v)} />}>
        <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
          Is this product diluted before bottling? Yield is gated by how much concentrate each bottle uses.
        </p>
        {input.diluted && (
          <>
            <Field label="Concentrate per bottle" hint={`in ${input.finishedUnit}`}>
              <NumInput value={input.concentratePerBottle} onChange={(v) => set("concentratePerBottle", v)} />
            </Field>
            <Field label="Water added per bottle" hint={`in ${input.finishedUnit}`}>
              <NumInput value={input.waterPerBottle} onChange={(v) => set("waterPerBottle", v)} />
            </Field>
          </>
        )}
      </Section>

      {/* 4. Packaging */}
      <Section title="Packaging costs" icon={<Package size={15} />}>
        <CostLineField label="Bottle" line={input.packaging.bottle} onChange={(p) => setLine("bottle", p)} />
        <CostLineField label="Label" line={input.packaging.label} onChange={(p) => setLine("label", p)} />
        <CostLineField label="Cap / sprayer" line={input.packaging.sprayer} onChange={(p) => setLine("sprayer", p)} />
        <CostLineField label="Safety seal" optional line={input.packaging.safetySeal} onChange={(p) => setLine("safetySeal", p)} />
        <CostLineField label="Box / mailer / insert" optional line={input.packaging.box} onChange={(p) => setLine("box", p)} />
        <CalloutRow label="Packaging per unit" value={fmt$(m.cost.packagingPerUnit)} />
      </Section>

      {/* 5. Labor */}
      <Section title="Labor" icon={<Sparkles size={15} />}>
        <Field label="Time to produce batch (minutes)">
          <NumInput value={input.labor.batchMinutes} onChange={(v) => set("labor", { ...input.labor, batchMinutes: v })} />
        </Field>
        <Field label="Hourly labor rate">
          <MoneyInput value={input.labor.hourlyRate} onChange={(v) => set("labor", { ...input.labor, hourlyRate: v })} />
        </Field>
        <CalloutRow label="Labor per unit" value={fmt$(m.cost.laborPerUnit)} hint={`batch ${fmt$(m.cost.laborBatch)}`} />
      </Section>

      {/* 6. Additional costs + fees */}
      <Section title="Additional costs" icon={<Package size={15} />}>
        <Field label="Shipping from supplier"><MoneyInput value={input.additional.shipping} onChange={(v) => set("additional", { ...input.additional, shipping: v })} /></Field>
        <Field label="Customs / tariffs"><MoneyInput value={input.additional.customs} onChange={(v) => set("additional", { ...input.additional, customs: v })} /></Field>
        <Field label="Miscellaneous"><MoneyInput value={input.additional.misc} onChange={(v) => set("additional", { ...input.additional, misc: v })} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Processing fee %"><NumInput value={input.fees.processingPct} onChange={(v) => set("fees", { ...input.fees, processingPct: v })} /></Field>
          <Field label="Tax %"><NumInput value={input.fees.taxPct} onChange={(v) => set("fees", { ...input.fees, taxPct: v })} /></Field>
        </div>
      </Section>

      {/* Cost breakdown */}
      <Section title="Cost breakdown" icon={<BarChart3 size={15} />}>
        {m.cost.perUnitLines.length === 0 ? (
          <p style={{ fontSize: 12, color: C.muted }}>Add costs above to see the per-unit breakdown.</p>
        ) : (
          m.cost.perUnitLines.map((l) => (
            <div key={l.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderBottom: `1px solid ${C.hairline}` }}>
              <span style={{ color: C.coffee }}>{l.label}</span>
              <span style={{ color: C.espresso, fontWeight: 600 }}>{fmt$(l.amount)}</span>
            </div>
          ))
        )}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 700, marginTop: 8 }}>
          <span style={{ color: C.espresso }}>True cost per unit</span>
          <span style={{ color: C.goldDeep }}>{fmt$(m.cost.costPerUnit)}</span>
        </div>
      </Section>

      {/* Smart pricing */}
      <Section title="Smart pricing" icon={<Sparkles size={15} />}>
        <CalloutRow label="Suggested wholesale" value={fmt$(m.wholesale)} hint="cost × 2" />
        <p style={{ ...labelStyle, marginTop: 6 }}>Target retail margin</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {MARGIN_PRESETS.map((mp) => (
            <button key={mp} type="button"
              onClick={() => { setCustomMargin(false); set("marginPct", mp); }}
              style={input.marginPct === mp && !customMargin ? marginChipActive : marginChip}>
              {mp}%
            </button>
          ))}
          <button type="button" onClick={() => setCustomMargin(true)} style={customMargin ? marginChipActive : marginChip}>
            Custom
          </button>
        </div>
        {customMargin && (
          <Field label="Custom margin %">
            <NumInput value={input.marginPct} onChange={(v) => set("marginPct", v)} />
          </Field>
        )}

        <div style={{ ...cardStyle, padding: 0, marginTop: 12, overflow: "hidden" }}>
          {m.pricing.map((row) => {
            const isSel = Math.round(row.marginPct) === Math.round(input.marginPct);
            return (
              <div key={row.marginPct} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: isSel ? "rgba(124,58,237,0.07)" : "transparent", borderBottom: `1px solid ${C.hairline}` }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.coffee }}>{row.marginPct}% margin</span>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600, color: isSel ? C.goldDeep : C.espresso }}>
                  {fmt$(row.rounded)}
                </span>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Revenue forecast */}
      <Section title="Revenue forecast" icon={<BarChart3 size={15} />}>
        <Field label="Units expected to sell">
          <NumInput value={input.unitsToSell} onChange={(v) => set("unitsToSell", v)} />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
          <Kpi label="Gross revenue" value={fmt$(m.forecast.grossRevenue)} />
          <Kpi label="Gross profit" value={fmt$(m.forecast.totalProfit)} tone="success" />
          <Kpi label="Net profit" value={fmt$(m.forecast.netProfit)} tone="success" hint="after fees & tax" />
          <Kpi label="ROI" value={fmtPct(m.forecast.roiPct)} tone="gold" />
          <Kpi label="Break-even" value={m.forecast.breakEvenUnits == null ? "—" : `${m.forecast.breakEvenUnits} units`} />
          <Kpi label="Retail price" value={fmt$(m.suggestedRetail)} />
        </div>
      </Section>

      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        <button type="button" onClick={onCancel} style={{ ...ghostButton, flex: 1 }}>Cancel</button>
        <button type="button" onClick={submit} disabled={saving} style={{ ...primaryButton, flex: 2, opacity: saving ? 0.6 : 1 }}>
          {saving ? "Saving…" : "Save product"}
        </button>
      </div>
    </Shell>
  );
}

// ---- Reporting dashboard ----------------------------------------------

function ReportDashboard({ products, onBack }: { products: SavedProduct[]; onBack: () => void }) {
  const ranked = useMemo(() => rankProducts(products), [products]);
  const avgCost = useMemo(() => averageCostPerUnit(products), [products]);

  const byProfit = ranked.slice(0, 6);
  const lowestMargin = [...ranked].filter((r) => r.marginPct != null).sort((a, b) => (a.marginPct! - b.marginPct!)).slice(0, 6);
  const byRevenue = [...ranked].filter((r) => r.forecastRevenue > 0).sort((a, b) => b.forecastRevenue - a.forecastRevenue).slice(0, 6);

  return (
    <Shell title="Reports" onBack={onBack}>
      {ranked.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <p style={{ fontSize: 14, color: C.coffee }}>No active products yet.</p>
          <p style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Save a product to see profit reports here.</p>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <MiniStat label="Active products" value={String(ranked.length)} />
            <MiniStat label="Avg cost / unit" value={fmt$(avgCost)} />
          </div>

          <ChartBlock title="Highest unit profit" rows={byProfit.map((r) => ({ label: r.name, value: r.unitProfit, display: fmt$(r.unitProfit) }))} tone={C.success} />
          <ChartBlock title="Lowest margin" rows={lowestMargin.map((r) => ({ label: r.name, value: r.marginPct ?? 0, display: fmtPct(r.marginPct) }))} tone={C.warning} />
          {byRevenue.length > 0 && (
            <ChartBlock title="Forecast revenue by product" rows={byRevenue.map((r) => ({ label: r.name, value: r.forecastRevenue, display: fmt$(r.forecastRevenue) }))} tone={C.goldDeep} />
          )}
        </>
      )}
    </Shell>
  );
}

function ChartBlock({ title, rows, tone }: { title: string; rows: Array<{ label: string; value: number; display: string }>; tone: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <Section title={title} icon={<BarChart3 size={15} />}>
      {rows.length === 0 ? (
        <p style={{ fontSize: 12, color: C.muted }}>Not enough data yet.</p>
      ) : rows.map((r, i) => (
        <div key={i} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
            <span style={{ color: C.coffee, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>{r.label}</span>
            <span style={{ color: C.espresso, fontWeight: 700 }}>{r.display}</span>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: C.ivory, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.max(4, (Math.abs(r.value) / max) * 100)}%`, background: tone, borderRadius: 999 }} />
          </div>
        </div>
      ))}
    </Section>
  );
}

// ---- Shared primitives -------------------------------------------------

function Shell({
  children, loading, title, onBack, headerAction,
}: {
  children?: React.ReactNode;
  loading?: boolean;
  title?: string;
  onBack?: () => void;
  headerAction?: { icon: React.ReactNode; label: string; onClick: () => void };
}) {
  return (
    <div style={{ minHeight: "100dvh", background: C.cream, fontFamily: FONT_BODY, color: C.espresso }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=DM+Sans:wght@400;500;600;700&display=swap');
        body { margin: 0; }
        input, select, button { font-family: ${FONT_BODY}; }
      `}</style>
      <div className="mx-auto" style={{ maxWidth: 480, padding: "20px 20px", paddingBottom: "calc(48px + env(safe-area-inset-bottom, 0px))" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          {onBack ? (
            <button type="button" onClick={onBack} style={iconButton} aria-label="Back"><ChevronLeft size={20} /></button>
          ) : <span style={{ width: 38 }} />}
          <div style={{ textAlign: "center", flex: 1 }}>
            <p style={{ letterSpacing: "0.22em", textTransform: "uppercase", fontSize: 9, fontWeight: 700, color: C.gold }}>
              Product Profit Calculator
            </p>
            <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 600, color: C.espresso, lineHeight: 1.1, marginTop: 2 }}>
              {title || "Settings"}
            </h1>
          </div>
          {headerAction ? (
            <button type="button" onClick={headerAction.onClick} style={iconButton} aria-label={headerAction.label}>
              {headerAction.icon}
            </button>
          ) : <span style={{ width: 38 }} />}
        </div>
        <div style={{ display: "grid", gap: 14 }}>
          {loading ? <p style={{ fontSize: 13, color: C.muted, textAlign: "center" }}>Loading…</p> : children}
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon, right, children }: { title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {icon && <span style={{ color: C.goldDeep }}>{icon}</span>}
          <h2 style={{ fontSize: 14, fontWeight: 700, color: C.espresso }}>{title}</h2>
        </div>
        {right}
      </div>
      <div style={{ display: "grid", gap: 10 }}>{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.coffee }}>{label}</span>
        {hint && <span style={{ fontSize: 10.5, color: C.muted }}>{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={inputStyle} />;
}

function NumInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(value ? String(value) : "");
  // Sync down when the parent resets the value (load draft, margin preset, etc.).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- prop-driven sync, intentional
  useEffect(() => { setText((prev) => (Number(prev) === value ? prev : value ? String(value) : "")); }, [value]);
  return (
    <input
      type="text" inputMode="decimal" value={text} placeholder="0"
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.]/g, "");
        setText(t);
        onChange(t === "" ? 0 : parseFloat(t) || 0);
      }}
      style={inputStyle}
    />
  );
}

function MoneyInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.muted, fontSize: 14 }}>$</span>
      <div style={{ paddingLeft: 14 }}>
        <NumInputPadded value={value} onChange={onChange} />
      </div>
    </div>
  );
}
function NumInputPadded({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(value ? String(value) : "");
  // eslint-disable-next-line react-hooks/set-state-in-effect -- prop-driven sync, intentional
  useEffect(() => { setText((prev) => (Number(prev) === value ? prev : value ? String(value) : "")); }, [value]);
  return (
    <input
      type="text" inputMode="decimal" value={text} placeholder="0.00"
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.]/g, "");
        setText(t);
        onChange(t === "" ? 0 : parseFloat(t) || 0);
      }}
      style={{ ...inputStyle, paddingLeft: 24 }}
    />
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, appearance: "none", WebkitAppearance: "none", background: `${C.paper} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%236F6477' d='M6 8 0 0h12z'/%3E%3C/svg%3E") no-repeat right 14px center` }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function SizeRow({ value, unit, onValue, onUnit }: { value: number; unit: SizeUnit; onValue: (v: number) => void; onUnit: (u: SizeUnit) => void }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <div style={{ flex: 1 }}><NumInput value={value} onChange={onValue} /></div>
      <div style={{ display: "flex", borderRadius: 12, border: `1px solid ${C.hairline}`, overflow: "hidden" }}>
        {(["oz", "ml"] as SizeUnit[]).map((u) => (
          <button key={u} type="button" onClick={() => onUnit(u)}
            style={{ padding: "0 16px", minHeight: 48, border: 0, fontSize: 13, fontWeight: 600, cursor: "pointer",
              background: unit === u ? C.goldDeep : C.paper, color: unit === u ? "#fff" : C.muted }}>
            {u}
          </button>
        ))}
      </div>
    </div>
  );
}

function CostLineField({ label, line, optional, onChange }: { label: string; line: CostLine; optional?: boolean; onChange: (p: Partial<CostLine>) => void }) {
  const qty = Number(line.quantity) || 0;
  const per = qty > 0 ? (Number(line.totalCost) || 0) / qty : 0;
  return (
    <div>
      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.coffee }}>{label}{optional && <span style={{ color: C.muted, fontWeight: 400 }}> · optional</span>}</span>
        <span style={{ fontSize: 11, color: per > 0 ? C.goldDeep : C.muted, fontWeight: 600 }}>{fmt$(per)} / unit</span>
      </span>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}><MoneyInput value={line.totalCost} onChange={(v) => onChange({ totalCost: v })} /></div>
        <div style={{ flex: 1 }}>
          <div style={{ position: "relative" }}>
            <NumInput value={line.quantity} onChange={(v) => onChange({ quantity: v })} />
            <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: C.muted, fontSize: 11, pointerEvents: "none" }}>qty</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      style={{ position: "relative", width: 46, height: 28, flexShrink: 0, borderRadius: 999, border: 0, cursor: "pointer", background: checked ? C.goldDeep : C.hairline, transition: "background 120ms ease" }}>
      <span aria-hidden style={{ position: "absolute", top: 3, left: checked ? 21 : 3, width: 22, height: 22, borderRadius: 999, background: C.paper, transition: "left 120ms ease" }} />
    </button>
  );
}

function CalloutRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderRadius: 12, background: C.ivory }}>
      <div>
        <p style={{ fontSize: 12.5, fontWeight: 600, color: C.coffee }}>{label}</p>
        {hint && <p style={{ fontSize: 10.5, color: C.muted }}>{hint}</p>}
      </div>
      <p style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.goldDeep }}>{value}</p>
    </div>
  );
}

function Kpi({ label, value, tone, hint }: { label: string; value: string; tone?: "success" | "gold"; hint?: string }) {
  const color = tone === "success" ? C.success : tone === "gold" ? C.goldDeep : C.espresso;
  return (
    <div style={{ ...cardStyle, padding: 14, boxShadow: "none", border: `1px solid ${C.hairline}` }}>
      <p style={labelStyle}>{label}</p>
      <p style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600, color, lineHeight: 1.1, marginTop: 2 }}>{value}</p>
      {hint && <p style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{hint}</p>}
    </div>
  );
}

function Stat({ label, value, tone, small }: { label: string; value: string; tone?: "gold" | "success"; small?: boolean }) {
  const color = tone === "success" ? C.success : tone === "gold" ? C.goldDeep : C.espresso;
  return (
    <div>
      <p style={{ ...labelStyle, fontSize: 9 }}>{label}</p>
      <p style={{ fontFamily: FONT_DISPLAY, fontSize: small ? 17 : 22, fontWeight: 600, color, lineHeight: 1.1, marginTop: 1 }}>{value}</p>
    </div>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 12.5, color: C.danger, padding: "10px 12px", borderRadius: 10, background: "rgba(156,61,46,0.08)" }}>{children}</p>;
}

// ---- Styles ------------------------------------------------------------

const cardStyle: React.CSSProperties = {
  padding: 16, borderRadius: 16, background: C.cream,
  border: `1px solid ${C.hairline}`,
  boxShadow: "0 1px 2px rgba(21,17,26,0.04), 0 8px 24px -16px rgba(21,17,26,0.12)",
};

const labelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.muted,
};

const inputStyle: React.CSSProperties = {
  width: "100%", minHeight: 48, padding: "0 14px", borderRadius: 12,
  border: `1px solid ${C.hairline}`, background: C.paper, color: C.espresso,
  fontSize: 15, outline: "none", boxSizing: "border-box",
};

const primaryButton: React.CSSProperties = {
  padding: "14px 16px", borderRadius: 14,
  background: `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`,
  color: C.paper, border: `1px solid ${C.goldDeep}`, fontSize: 14, fontWeight: 700,
  cursor: "pointer", minHeight: 48, textAlign: "center",
};

const ghostButton: React.CSSProperties = {
  padding: "12px 16px", borderRadius: 12, background: C.paper, color: C.coffee,
  border: `1px solid ${C.hairline}`, fontSize: 13, fontWeight: 600, cursor: "pointer", minHeight: 48,
};

const iconButton: React.CSSProperties = {
  width: 38, height: 38, display: "grid", placeItems: "center", borderRadius: 10,
  background: C.paper, border: `1px solid ${C.hairline}`, color: C.coffee, cursor: "pointer", flexShrink: 0,
};

const chip: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 11px", borderRadius: 999,
  background: C.ivory, border: `1px solid ${C.hairline}`, color: C.coffee, fontSize: 12, fontWeight: 600, cursor: "pointer",
};

const marginChip: React.CSSProperties = {
  padding: "9px 14px", borderRadius: 999, background: C.paper, border: `1px solid ${C.hairline}`,
  color: C.coffee, fontSize: 13, fontWeight: 700, cursor: "pointer", minWidth: 52,
};
const marginChipActive: React.CSSProperties = {
  ...marginChip, background: `linear-gradient(180deg, ${C.gold}, ${C.goldDeep})`, color: "#fff", border: `1px solid ${C.goldDeep}`,
};
