"use client";

// Public class detail at /@handle/classes/<slug>. Shows the class,
// collects a name + email + seat count, and starts Stripe checkout on
// the braider's connected account via /api/class-checkout.
//
// Two extra states, both driven by query params the checkout route
// sets on its return URLs:
//   • ?registered=<token> — payment came back; poll the registration
//     RPC until the webhook flips it to paid, then reveal the access
//     details (location for in-person, meeting link for virtual).
//   • ?cancelled=1        — the buyer backed out of Stripe.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  StorefrontShell,
  C,
  GRADIENTS,
  SHADOWS,
  FONT_DISPLAY,
  fmtMoney,
} from "../../_components/StorefrontShell";
import { useStylistProfile } from "../../_components/useStylistProfile";
import {
  fetchPublicClass,
  fetchClassRegistration,
  startClassCheckout,
  formatClassWhen,
  type PublicClassDetail,
  type ClassRegistration,
} from "../../../../lib/academy";

export default function ClassDetailPage() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const handle = useMemo(() => {
    const raw = params?.handle;
    const v = Array.isArray(raw) ? raw[0] : raw || "";
    return decodeURIComponent(v).replace(/^@/, "");
  }, [params]);
  const classSlug = useMemo(() => {
    const raw = params?.classSlug;
    const v = Array.isArray(raw) ? raw[0] : raw || "";
    return decodeURIComponent(v);
  }, [params]);

  const registeredToken = search?.get("registered") || null;
  const cancelled = search?.get("cancelled") === "1";

  const profileState = useStylistProfile(handle);

  const [klass, setKlass] = useState<PublicClassDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profileState.status !== "ready") return;
    let cancelledEffect = false;
    (async () => {
      setLoading(true);
      const r = await fetchPublicClass(profileState.profile.slug, classSlug);
      if (cancelledEffect) return;
      if (!r.ok) {
        setError(r.error);
        setKlass(null);
      } else {
        setError(null);
        setKlass(r.klass);
      }
      setLoading(false);
    })();
    return () => {
      cancelledEffect = true;
    };
  }, [profileState.status, profileState.status === "ready" ? profileState.profile.slug : "", classSlug]);

  if (profileState.status === "loading") {
    return <CenterNote text="Loading…" />;
  }
  if (profileState.status === "not_found") {
    return <CenterNote text="Storefront not found." />;
  }

  return (
    <StorefrontShell
      handle={handle}
      businessName={profileState.profile.shop_name || profileState.profile.business_name}
      description={profileState.profile.shop_description}
      bannerUrl={profileState.profile.shop_banner_url || profileState.profile.banner_image_url}
      logoUrl={profileState.profile.shop_logo_url || profileState.profile.logo_url}
      active="classes"
    >
      <button
        type="button"
        onClick={() => router.push(`/@${encodeURIComponent(handle)}/classes`)}
        className="text-[13px] font-semibold mb-4"
        style={{ color: C.muted }}
      >
        ← All classes
      </button>

      {registeredToken ? (
        <ConfirmationPanel token={registeredToken} />
      ) : loading ? (
        <div style={{ height: 320, borderRadius: 16, background: C.ivory }} className="animate-pulse" />
      ) : error || !klass ? (
        <CenterNote text={error || "That class isn't available."} inline />
      ) : (
        <ClassBooking klass={klass} handle={handle} cancelled={cancelled} />
      )}
    </StorefrontShell>
  );
}

function ClassBooking({
  klass,
  handle,
  cancelled,
}: {
  klass: PublicClassDetail;
  handle: string;
  cancelled: boolean;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [seats, setSeats] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const full = klass.seats_remaining != null && klass.seats_remaining <= 0;
  const maxSeats = klass.seats_remaining != null ? Math.min(klass.seats_remaining, 10) : 10;
  const notReady = !klass.stylist_account_id || !klass.stylist_charges_enabled;

  const submit = async () => {
    setFormError(null);
    if (!name.trim()) return setFormError("Please enter your name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setFormError("Please enter a valid email.");
    setSubmitting(true);
    const r = await startClassCheckout({
      handle,
      classSlug: klass.slug,
      seats,
      studentName: name.trim(),
      studentEmail: email.trim(),
    });
    if (!r.ok) {
      setFormError(r.error);
      setSubmitting(false);
      return;
    }
    window.location.href = r.url;
  };

  return (
    <>
      {/* Cover */}
      <div
        style={{
          height: 200,
          borderRadius: 16,
          background: klass.cover_image_url
            ? `url(${klass.cover_image_url}) center / cover no-repeat`
            : GRADIENTS.hero,
          boxShadow: SHADOWS.card,
        }}
      />

      <div className="flex items-center gap-2 mt-4">
        <span
          className="text-[11px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full"
          style={{ color: C.brandPrimary, background: "rgba(124,58,237,0.08)", letterSpacing: "0.1em" }}
        >
          {klass.format === "virtual" ? "Virtual class" : "In-person class"}
        </span>
        {klass.seats_remaining != null && !full && klass.seats_remaining <= 5 && (
          <span className="text-[11px] font-bold" style={{ color: C.brandWarning }}>
            Only {klass.seats_remaining} left
          </span>
        )}
      </div>

      <h1
        className="mt-2"
        style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 700, color: C.brandText, lineHeight: 1.15 }}
      >
        {klass.title}
      </h1>

      <div className="mt-2 space-y-1 text-[14px]" style={{ color: C.coffee }}>
        <p>🗓️ {formatClassWhen(klass.starts_at, klass.timezone)}</p>
        {klass.duration_minutes ? <p>⏱️ {klass.duration_minutes} minutes</p> : null}
        <p className="font-bold" style={{ color: C.brandPrimary }}>
          {fmtMoney(klass.price, klass.currency.toUpperCase())} per seat
        </p>
      </div>

      {klass.description?.trim() && (
        <p className="mt-4 text-[15px] whitespace-pre-wrap" style={{ color: C.coffee, lineHeight: 1.6 }}>
          {klass.description.trim()}
        </p>
      )}

      <p className="mt-4 text-[12px]" style={{ color: C.mutedSoft }}>
        {klass.format === "virtual"
          ? "You'll get the meeting link by email as soon as you pay."
          : "You'll get the exact location by email as soon as you pay."}
      </p>

      <div className="mt-6 rounded-2xl p-4" style={{ background: C.ivory }}>
        {cancelled && (
          <p
            className="text-[13px] mb-3 px-3 py-2 rounded-lg"
            style={{ background: "rgba(251,191,36,0.14)", color: "#92600A" }}
          >
            Checkout was cancelled — no charge was made. You can try again below.
          </p>
        )}

        {notReady ? (
          <p className="text-[14px]" style={{ color: C.muted }}>
            {"This braider isn't accepting payments yet. Please check back soon."}
          </p>
        ) : full ? (
          <p className="text-[15px] font-semibold" style={{ color: C.brandError }}>
            This class is full.
          </p>
        ) : (
          <>
            <label className="block text-[12px] font-bold uppercase tracking-widest mb-1" style={{ color: C.muted }}>
              Your name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              className="w-full mb-3 px-3 py-2.5 rounded-lg text-[15px]"
              style={{ border: `1px solid ${C.brandBorder}`, background: C.paper, color: C.brandText }}
            />
            <label className="block text-[12px] font-bold uppercase tracking-widest mb-1" style={{ color: C.muted }}>
              Email
            </label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              inputMode="email"
              placeholder="you@email.com"
              className="w-full mb-3 px-3 py-2.5 rounded-lg text-[15px]"
              style={{ border: `1px solid ${C.brandBorder}`, background: C.paper, color: C.brandText }}
            />
            {maxSeats > 1 && (
              <>
                <label
                  className="block text-[12px] font-bold uppercase tracking-widest mb-1"
                  style={{ color: C.muted }}
                >
                  Seats
                </label>
                <select
                  value={seats}
                  onChange={(e) => setSeats(Number(e.target.value))}
                  className="w-full mb-3 px-3 py-2.5 rounded-lg text-[15px]"
                  style={{ border: `1px solid ${C.brandBorder}`, background: C.paper, color: C.brandText }}
                >
                  {Array.from({ length: maxSeats }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? "seat" : "seats"} · {fmtMoney(klass.price * n, klass.currency.toUpperCase())}
                    </option>
                  ))}
                </select>
              </>
            )}

            {formError && (
              <p className="text-[13px] mb-2" style={{ color: C.brandError }}>
                {formError}
              </p>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="w-full py-3 rounded-xl text-[15px] font-bold text-white transition"
              style={{ background: GRADIENTS.primary, boxShadow: SHADOWS.primaryGlow, opacity: submitting ? 0.7 : 1 }}
            >
              {submitting
                ? "Starting checkout…"
                : `Reserve ${seats > 1 ? `${seats} seats` : "my seat"} · ${fmtMoney(
                    klass.price * seats,
                    klass.currency.toUpperCase(),
                  )}`}
            </button>
            <p className="text-[11px] text-center mt-2" style={{ color: C.mutedSoft }}>
              Secure checkout by Stripe. {process.env.NEXT_PUBLIC_PLATFORM_FEE_NOTE || ""}
            </p>
          </>
        )}
      </div>
    </>
  );
}

function ConfirmationPanel({ token }: { token: string }) {
  const [reg, setReg] = useState<ClassRegistration | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll a few times while the webhook catches up (Stripe usually fires
  // within a second or two, but the redirect can beat it). All state
  // updates happen inside the async runner, never synchronously in the
  // effect body.
  useEffect(() => {
    let stop = false;
    let count = 0;
    const run = () => {
      void (async () => {
        const r = await fetchClassRegistration(token);
        if (stop) return;
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setError(null);
        setReg(r.registration);
        if (r.registration.status === "paid") clearInterval(id);
      })();
    };
    const id = setInterval(() => {
      count += 1;
      if (count > 6) {
        clearInterval(id);
        return;
      }
      run();
    }, 2500);
    run();
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [token]);

  if (error) return <CenterNote text={error} inline />;
  if (!reg) return <CenterNote text="Confirming your sign-up…" inline />;

  const paid = reg.status === "paid";

  return (
    <div className="rounded-2xl p-6 text-center" style={{ background: C.ivory }}>
      <div
        className="mx-auto mb-4 grid place-items-center rounded-full"
        style={{ width: 56, height: 56, background: paid ? "rgba(34,197,94,0.15)" : "rgba(124,58,237,0.12)" }}
      >
        <span style={{ fontSize: 28 }}>{paid ? "🎉" : "⏳"}</span>
      </div>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 700, color: C.brandText }}>
        {paid ? "You're signed up!" : "Confirming your payment…"}
      </h1>
      <p className="text-[15px] mt-1" style={{ color: C.coffee }}>
        {reg.class_title}
      </p>
      <p className="text-[14px] mt-1" style={{ color: C.muted }}>
        {formatClassWhen(reg.starts_at, reg.timezone)}
        {reg.seats > 1 ? ` · ${reg.seats} seats` : ""}
      </p>

      {paid ? (
        <div className="mt-5 text-left rounded-xl p-4" style={{ background: C.paper, border: `1px solid ${C.brandBorder}` }}>
          <p className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: C.muted }}>
            {reg.format === "virtual" ? "Join link" : "Location"}
          </p>
          {reg.format === "virtual" ? (
            reg.meeting_url ? (
              <a href={reg.meeting_url} className="text-[15px] font-semibold break-all" style={{ color: C.brandPrimary }}>
                {reg.meeting_url}
              </a>
            ) : (
              <p className="text-[14px]" style={{ color: C.muted }}>
                Your braider will send the join link before the class.
              </p>
            )
          ) : reg.location_text ? (
            <p className="text-[15px]" style={{ color: C.brandText }}>
              {reg.location_text}
            </p>
          ) : (
            <p className="text-[14px]" style={{ color: C.muted }}>
              Your braider will share the location shortly.
            </p>
          )}
          <p className="text-[12px] mt-3" style={{ color: C.mutedSoft }}>
            We also emailed these details to you.
          </p>
        </div>
      ) : (
        <p className="text-[13px] mt-4" style={{ color: C.mutedSoft }}>
          This can take a few seconds. Your access details and a confirmation email will appear as soon as
          the payment clears.
        </p>
      )}
    </div>
  );
}

function CenterNote({ text, inline }: { text: string; inline?: boolean }) {
  if (inline) {
    return (
      <p className="text-center py-14 text-[15px]" style={{ color: C.muted }}>
        {text}
      </p>
    );
  }
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, color: C.muted }}>
      {text}
    </div>
  );
}
