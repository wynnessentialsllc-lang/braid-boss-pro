"use client";

// "Build your style" — client-facing AI consultation on the booking page.
//
// For when a client doesn't see the style they want. They upload an
// inspiration photo, answer a few questions, and get a BALLPARK quote
// (anchored to the stylist's real catalog, pending review). If they like
// it, the request is sent to the stylist's review queue with a desired
// date/time. The stylist approves (-> deposit) or denies from the app.
//
// v1: the photo is used for the AI estimate only (not persisted); the
// saved request carries the answers, notes, desired date/time, and the AI
// snapshot. Photo persistence can be added later via a storage bucket.

import { useRef, useState } from "react";
import {
  validateStyleIntake,
  STYLE_SIZES,
  STYLE_LENGTHS,
  STYLE_SIZE_LABEL,
  STYLE_LENGTH_LABEL,
  type StyleIntake,
} from "../../lib/style-request";

type Props = {
  slug: string;
  userId: string;
  accent?: string;
  currency?: string;
  /** Start expanded (skip the "Don't see your style?" launcher) — used when
   *  opened from inside the booking assistant. */
  autoOpen?: boolean;
};

type Quote = {
  styleFamily: string | null;
  sizeGuess: string | null;
  lengthGuess: string | null;
  rationale: string | null;
  matchedServiceId: string | null;
  matchedServiceName: string | null;
  priceLow: number | null;
  priceHigh: number | null;
  estDurationHours: number | null;
  anchored: boolean;
};

const fmt = (n: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

// Downscale an uploaded image to a base64 JPEG suitable for the vision
// call (keeps the request small). Returns { data, media_type }.
const toBase64Image = (file: File, maxEdge = 1024): Promise<{ data: string; media_type: string }> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        resolve({ data: dataUrl.slice(dataUrl.indexOf(",") + 1), media_type: "image/jpeg" });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });

export default function BuildYourStyle({ slug, userId, accent = "#7C3AED", currency = "USD", autoOpen = false }: Props) {
  const [open, setOpen] = useState(autoOpen);
  const fileRef = useRef<HTMLInputElement>(null);

  // Intake
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [imageB64, setImageB64] = useState<{ data: string; media_type: string } | null>(null);
  const [size, setSize] = useState("");
  const [length, setLength] = useState("");
  const [hairIncluded, setHairIncluded] = useState<"" | "yes" | "no">("");
  const [humanHair, setHumanHair] = useState<"" | "yes" | "no">("");
  const [color, setColor] = useState("");
  const [notes, setNotes] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [quote, setQuote] = useState<Quote | null>(null);
  const [savedPhotoPath, setSavedPhotoPath] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const intake = (): StyleIntake => ({
    clientName: name,
    clientPhone: phone,
    clientEmail: email,
    photoPath: photoName, // presence flag for validation (not persisted in v1)
    size,
    length,
    hairIncluded: hairIncluded === "" ? null : hairIncluded === "yes",
    humanHair: humanHair === "" ? null : humanHair === "yes",
    color,
    notes,
    preferredDate,
    preferredTime,
  });

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setPhotoName(file.name);
    try {
      setImageB64(await toBase64Image(file));
    } catch {
      setError("Couldn't read that image. Try another photo.");
      setImageB64(null);
      setPhotoName(null);
    }
  };

  const getEstimate = async () => {
    setError(null);
    if (!size || !length) { setError("Pick a size and length first."); return; }
    if (!imageB64 && !notes.trim()) { setError("Add a photo or describe the style."); return; }
    setQuoting(true);
    setQuote(null);
    try {
      const res = await fetch("/api/style-consult", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug,
          image_base64: imageB64?.data ?? null,
          media_type: imageB64?.media_type ?? null,
          intake: {
            size, length, color, notes,
            hairIncluded: hairIncluded === "" ? null : hairIncluded === "yes",
            humanHair: humanHair === "" ? null : humanHair === "yes",
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error || "Couldn't get an estimate."); return; }
      setQuote(body.quote as Quote);
      if (typeof body.photo_path === "string") setSavedPhotoPath(body.photo_path);
    } catch {
      setError("Couldn't reach the estimator. You can still send your request to the stylist.");
    } finally {
      setQuoting(false);
    }
  };

  const sendToStylist = async () => {
    setError(null);
    const v = validateStyleIntake(intake());
    if (!v.ok) { setError(v.errors[0]); return; }
    setSubmitting(true);
    try {
      // Submit through the server route (rate-limited + owner-validated)
      // rather than inserting directly with the anon key. See
      // app/api/style-request-submit.
      const res = await fetch("/api/style-request-submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          client_name: name.trim(),
          client_phone: phone.trim() || null,
          client_email: email.trim() || null,
          photo_path: savedPhotoPath, // persisted by the estimate route (if used)
          size: size || null,
          length: length || null,
          hair_included: hairIncluded === "" ? null : hairIncluded === "yes",
          human_hair: humanHair === "" ? null : humanHair === "yes",
          color: color.trim() || null,
          notes: notes.trim() || null,
          preferred_date: preferredDate || null,
          preferred_time: preferredTime || null,
          ai_style_family: quote?.styleFamily ?? null,
          ai_suggested_service_id: quote?.matchedServiceId ?? null,
          ai_price_low: quote?.priceLow ?? null,
          ai_price_high: quote?.priceHigh ?? null,
          ai_est_duration_hours: quote?.estDurationHours ?? null,
          ai_rationale: quote?.rationale ?? null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) {
        setError(body?.error || "Couldn't send your request. Please try again.");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Couldn't send your request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const label: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#3D3447", marginBottom: 4 };
  const input: React.CSSProperties = { width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(21,17,26,0.15)", fontSize: 14, background: "#fff", color: "#15111A" };
  // minmax(0,1fr) so a long option/value in either cell can't stretch the
  // 2-col row past the mobile viewport (1fr's default min is min-content).
  const row2: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10 };

  if (submitted) {
    return (
      <div style={{ border: `1px solid ${accent}33`, background: "#fff", borderRadius: 16, padding: 20, textAlign: "center" }}>
        <p style={{ fontSize: 16, fontWeight: 700, color: "#15111A", margin: 0 }}>Request sent! 🎉</p>
        <p style={{ fontSize: 13.5, color: "#6F6477", margin: "8px 0 0", lineHeight: 1.5 }}>
          {name.split(" ")[0] || "You"}, your style request is with the stylist. They&apos;ll review it and follow up to confirm pricing and a deposit to lock in your spot.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ width: "100%", padding: 16, borderRadius: 16, border: `1px dashed ${accent}`, background: "#fff", textAlign: "left", cursor: "pointer" }}
      >
        <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#15111A" }}>Don&apos;t see your style?</p>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6F6477" }}>Build it here — upload a photo, get a ballpark quote, and send it to the stylist.</p>
      </button>
    );
  }

  return (
    <div style={{ border: `1px solid ${accent}33`, background: "#fff", borderRadius: 16, padding: 20 }}>
      <p style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700, color: "#15111A" }}>Build your style</p>

      {/* Photo */}
      <div style={{ marginBottom: 12 }}>
        <span style={label}>Inspiration photo</span>
        <input ref={fileRef} type="file" accept="image/*" onChange={onPickPhoto} style={{ display: "none" }} />
        <button type="button" onClick={() => fileRef.current?.click()}
          style={{ ...input, textAlign: "left", cursor: "pointer", color: photoName ? "#15111A" : "#6F6477" }}>
          {photoName ? `📷 ${photoName}` : "Tap to upload a photo"}
        </button>
      </div>

      <div style={{ ...row2, marginBottom: 12 }}>
        <div>
          <span style={label}>Size</span>
          <select value={size} onChange={e => setSize(e.target.value)} style={input}>
            <option value="">Choose…</option>
            {STYLE_SIZES.map(s => <option key={s} value={s}>{STYLE_SIZE_LABEL[s]}</option>)}
          </select>
        </div>
        <div>
          <span style={label}>Length</span>
          <select value={length} onChange={e => setLength(e.target.value)} style={input}>
            <option value="">Choose…</option>
            {STYLE_LENGTHS.map(l => <option key={l} value={l}>{STYLE_LENGTH_LABEL[l]}</option>)}
          </select>
        </div>
      </div>

      <div style={{ ...row2, marginBottom: 12 }}>
        <div>
          <span style={label}>Hair included?</span>
          <select value={hairIncluded} onChange={e => setHairIncluded(e.target.value as any)} style={input}>
            <option value="">Not sure</option>
            <option value="yes">Stylist provides</option>
            <option value="no">I&apos;ll bring it</option>
          </select>
        </div>
        <div>
          <span style={label}>Human hair?</span>
          <select value={humanHair} onChange={e => setHumanHair(e.target.value as any)} style={input}>
            <option value="">Not sure</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <span style={label}>Color</span>
        <input value={color} onChange={e => setColor(e.target.value)} placeholder="e.g. natural black, honey blonde" style={input} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <span style={label}>Notes for the stylist</span>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Anything important — parting, curl pattern, occasion…" style={{ ...input, resize: "vertical" }} />
      </div>

      {/* Estimate */}
      <button type="button" onClick={getEstimate} disabled={quoting}
        style={{ width: "100%", padding: 12, borderRadius: 10, border: `1px solid ${accent}`, background: "#fff", color: accent, fontWeight: 700, fontSize: 14, cursor: "pointer", marginBottom: 12 }}>
        {quoting ? "Estimating…" : quote ? "Re-estimate" : "Get a Quote"}
      </button>

      {quote && (
        <div style={{ background: "#F6F2EC", borderRadius: 12, padding: 14, marginBottom: 12 }}>
          {quote.anchored && quote.priceLow != null && quote.priceHigh != null ? (
            <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#15111A" }}>
              ~{fmt(quote.priceLow, currency)}–{fmt(quote.priceHigh, currency)}
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#15111A" }}>The stylist will quote this on review.</p>
          )}
          <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#6F6477" }}>
            {quote.estDurationHours ? `Est. ${quote.estDurationHours}h · ` : ""}
            {quote.matchedServiceName ? `closest to “${quote.matchedServiceName}” · ` : ""}
            estimate, pending stylist review
          </p>
          {quote.rationale && <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "#3D3447", lineHeight: 1.45 }}>{quote.rationale}</p>}
        </div>
      )}

      {/* Contact + desired date/time */}
      <div style={{ ...row2, marginBottom: 12 }}>
        <div>
          <span style={label}>Desired date</span>
          <input type="date" value={preferredDate} onChange={e => setPreferredDate(e.target.value)} style={input} />
        </div>
        <div>
          <span style={label}>Desired time</span>
          <input type="time" value={preferredTime} onChange={e => setPreferredTime(e.target.value)} style={input} />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <span style={label}>Your name</span>
        <input value={name} onChange={e => setName(e.target.value)} style={input} />
      </div>
      <div style={{ ...row2, marginBottom: 12 }}>
        <div>
          <span style={label}>Phone</span>
          <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" style={input} />
        </div>
        <div>
          <span style={label}>Email</span>
          <input value={email} onChange={e => setEmail(e.target.value)} inputMode="email" style={input} />
        </div>
      </div>

      {error && <p style={{ margin: "0 0 10px", fontSize: 13, color: "#9C3D2E" }}>{error}</p>}

      <button type="button" onClick={sendToStylist} disabled={submitting}
        style={{ width: "100%", padding: 14, borderRadius: 12, border: "none", background: accent, color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
        {submitting ? "Sending…" : "Send request to stylist"}
      </button>
      <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "#9F95A8", textAlign: "center" }}>
        This sends a request — not a booking. The stylist confirms pricing and a deposit.
      </p>
    </div>
  );
}
