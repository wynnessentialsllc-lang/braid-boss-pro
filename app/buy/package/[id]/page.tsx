"use client";

// Public "buy a package" page. Anon. The stylist shares
// /buy/package/<template_id>; the buyer enters their name + email and is
// sent to Stripe Checkout (a direct charge on the stylist's connected
// account). The package is issued by the deposit webhook on completion.

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { getSupabase } from "../../../lib/supabase";

const C = {
  espresso: "#15111A", coffee: "#3D3447", paper: "#FFFFFF",
  ivory: "#F6F2EC", cream: "#FAF6EE",
  brandPrimary: "#7C3AED", brandDeep: "#5B21B6",
  gold: "#A8893F", muted: "#6F6477", hairline: "rgba(21, 17, 26, 0.12)",
  danger: "#9C3D2E", success: "#3F7D4F",
};
const FONT_DISPLAY = `"Cormorant Garamond", Georgia, serif`;
const FONT_BODY = `"DM Sans", "Inter", system-ui, sans-serif`;

type Template = {
  ok: true;
  id: string;
  name: string;
  kind: "visits" | "credit";
  visits: number | null;
  credit_amount: number | null;
  price: number;
  service_label: string | null;
  studio_name: string;
  can_charge: boolean;
};

const money = (n: number | null | undefined) => `$${(Number(n) || 0).toFixed(2)}`;

const Wrap = ({ children }: { children: React.ReactNode }) => (
  <div style={{
    minHeight: "100vh", background: C.ivory, color: C.espresso, fontFamily: FONT_BODY,
    padding: "32px 18px calc(40px + env(safe-area-inset-bottom, 0px))",
    paddingTop: "calc(28px + env(safe-area-inset-top, 0px))", WebkitFontSmoothing: "antialiased",
  }}>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=DM+Sans:wght@400;500;600;700;800&display=swap');`}</style>
    <div style={{ maxWidth: 460, margin: "0 auto" }}>{children}</div>
  </div>
);

const Card: React.FC<React.PropsWithChildren> = ({ children }) => (
  <div style={{ background: C.paper, borderRadius: 18, border: `1px solid ${C.hairline}`, padding: 20, boxShadow: "0 6px 22px -16px rgba(21,17,26,0.20)", marginBottom: 14 }}>
    {children}
  </div>
);

export default function BuyPackagePage() {
  const params = useParams();
  const search = useSearchParams();
  const status = search?.get("status");
  const id = useMemo(() => {
    const raw = params?.id;
    return Array.isArray(raw) ? raw[0] : raw || "";
  }, [params]);

  const [tpl, setTpl] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase.rpc("public_get_package_template", { template_id_in: id });
        if (cancelled) return;
        setLoading(false);
        if (error || !data || (data as any).ok !== true) { setErr("not_found"); return; }
        setTpl(data as Template);
      } catch {
        if (!cancelled) { setLoading(false); setErr("not_found"); }
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const buy = async () => {
    if (busy || !tpl) return;
    if (!email.trim() || !email.includes("@")) { setErr("Please enter a valid email."); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/package-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ template_id: tpl.id, buyer_name: name.trim() || null, buyer_email: email.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) { setErr(body?.error || "Couldn't start checkout."); setBusy(false); return; }
      window.location.assign(String(body.url));
    } catch {
      setErr("Couldn't reach the server. Try again.");
      setBusy(false);
    }
  };

  if (status === "success") {
    return (
      <Wrap>
        <Card>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 30, color: C.success, marginBottom: 6 }}>✓</div>
            <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 26, margin: "0 0 8px" }}>You&apos;re all set.</h1>
            <p style={{ margin: 0, color: C.coffee, fontSize: 14, lineHeight: 1.55 }}>
              Your package is purchased. Your stylist will see it and apply it to your visits.
            </p>
          </div>
        </Card>
      </Wrap>
    );
  }

  if (loading) {
    return <Wrap><Card><p style={{ margin: 0, textAlign: "center", color: C.muted }}>Loading…</p></Card></Wrap>;
  }
  if (err === "not_found" || !tpl) {
    return (
      <Wrap><Card>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 24, margin: "0 0 10px" }}>Package not found</h1>
        <p style={{ margin: 0, color: C.coffee, fontSize: 14, lineHeight: 1.55 }}>This link is no longer available. Reach out to your stylist.</p>
      </Card></Wrap>
    );
  }

  const contents = tpl.kind === "visits"
    ? `${tpl.visits} visit${Number(tpl.visits) === 1 ? "" : "s"}`
    : `${money(tpl.credit_amount)} credit`;

  return (
    <Wrap>
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <p style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.22em", textTransform: "uppercase", color: C.brandPrimary, margin: 0 }}>{tpl.studio_name}</p>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 30, lineHeight: 1.1, margin: "8px 0 0" }}>{tpl.name}</h1>
      </div>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.hairline}` }}>
          <span style={{ fontSize: 13, color: C.muted }}>Includes</span>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{contents}</span>
        </div>
        {tpl.service_label && (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.hairline}` }}>
            <span style={{ fontSize: 13, color: C.muted }}>For</span>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{tpl.service_label}</span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}>
          <span style={{ fontSize: 13, color: C.muted }}>Price</span>
          <span style={{ fontSize: 15, fontWeight: 800 }}>{money(tpl.price)}</span>
        </div>
      </Card>

      <Card>
        <label style={{ display: "block", fontSize: 12, color: C.muted, marginBottom: 4 }}>Your name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name"
          style={{ width: "100%", padding: "11px 12px", borderRadius: 10, border: `1px solid ${C.hairline}`, fontSize: 14, marginBottom: 12, fontFamily: FONT_BODY }} />
        <label style={{ display: "block", fontSize: 12, color: C.muted, marginBottom: 4 }}>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" type="email"
          style={{ width: "100%", padding: "11px 12px", borderRadius: 10, border: `1px solid ${C.hairline}`, fontSize: 14, fontFamily: FONT_BODY }} />
        {err && err !== "not_found" && <p style={{ fontSize: 12, color: C.danger, marginTop: 10 }}>{err}</p>}
        {!tpl.can_charge ? (
          <p style={{ fontSize: 12, color: C.danger, marginTop: 12, lineHeight: 1.5 }}>
            This stylist isn&apos;t set up to take online payments yet. Please reach out to them directly.
          </p>
        ) : (
          <button onClick={buy} disabled={busy}
            style={{
              marginTop: 14, width: "100%", padding: "15px 18px", borderRadius: 12,
              background: C.espresso, color: "#FFFFFF", border: 0, fontWeight: 700, fontSize: 15,
              cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
            }}>
            {busy ? "Starting checkout…" : `Buy · ${money(tpl.price)}`}
          </button>
        )}
      </Card>

      <p style={{ textAlign: "center", fontSize: 11, color: C.muted, marginTop: 6 }}>Powered by Braid Boss Pro</p>
    </Wrap>
  );
}
