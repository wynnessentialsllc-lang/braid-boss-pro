"use client";

// Public product detail at /@handle/products/<productSlug>.
// Shows the gallery, title, price (with optional compare-at
// strike-through), inventory hint, description, and a "Buy now"
// button that opens a Stripe Checkout Session on the stylist's
// connected account via /api/product-checkout.
//
// Phase 1 has no cart — buy buttons go straight to checkout. Cart
// + multi-item orders are a follow-up phase; the product_orders
// table is already shaped for n line items so adding the cart UI
// later won't need a schema migration.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
  fetchPublicProduct,
  fetchPublicProducts,
  PRODUCT_CATEGORY_LABEL,
  type PublicProduct,
  type PublicProductDetail,
} from "../../../../lib/storefront";

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const handle = useMemo(() => {
    const raw = params?.handle;
    const v = Array.isArray(raw) ? raw[0] : raw || "";
    return decodeURIComponent(v).replace(/^@/, "");
  }, [params]);
  const productSlug = useMemo(() => {
    const raw = params?.productSlug;
    const v = Array.isArray(raw) ? raw[0] : raw || "";
    return decodeURIComponent(v);
  }, [params]);

  const profileState = useStylistProfile(handle);

  const [product, setProduct] = useState<PublicProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [related, setRelated] = useState<PublicProduct[]>([]);

  // Gallery state — index into [image_url, ...gallery_images] with
  // duplicate-filtering to handle products that re-use the featured
  // image as the first gallery image.
  const [galleryIdx, setGalleryIdx] = useState(0);

  const gallery = useMemo(() => {
    if (!product) return [] as string[];
    const all = [product.image_url, ...product.gallery_images].filter(
      (s): s is string => !!s && s.trim().length > 0,
    );
    return Array.from(new Set(all));
  }, [product]);

  const onSale =
    product?.price != null &&
    product?.compare_at_price != null &&
    product.compare_at_price > product.price;
  const soldOut =
    product?.inventory_count != null && product.inventory_count <= 0;

  // Checkout button state
  const [buyState, setBuyState] = useState<"idle" | "loading" | "error">("idle");
  const [buyError, setBuyError] = useState<string | null>(null);

  useEffect(() => {
    if (profileState.status !== "ready") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const r = await fetchPublicProduct(profileState.profile.slug, productSlug);
      if (cancelled) return;
      if (!r.ok) {
        setError(r.error);
        setProduct(null);
      } else {
        setError(null);
        setProduct(r.product);
        // Pull the rest of the catalog for the "Related" rail. Cheap
        // (same RPC the shop page hits) and lets us surface 3 sibling
        // items below the fold without extra plumbing.
        const all = await fetchPublicProducts(profileState.profile.slug);
        if (!cancelled && all.ok) {
          setRelated(
            all.products
              .filter((p) => p.slug !== productSlug)
              .filter((p) =>
                r.product.category ? p.category === r.product.category : true,
              )
              .slice(0, 4),
          );
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileState.status, productSlug]);

  const startCheckout = async () => {
    if (!product) return;
    if (buyState === "loading") return;
    if (soldOut) return;
    if (product.external_checkout_url) {
      // External shop link wins — the stylist explicitly redirected
      // this product elsewhere.
      window.location.href = product.external_checkout_url;
      return;
    }
    if (!product.stylist_charges_enabled || !product.stylist_account_id) {
      setBuyState("error");
      setBuyError(
        "This stylist hasn't finished setting up payments. Try the booking link instead.",
      );
      return;
    }
    setBuyState("loading");
    setBuyError(null);
    try {
      const res = await fetch("/api/product-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle,
          product_slug: product.slug,
          quantity: 1,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) {
        setBuyState("error");
        setBuyError(body?.error || "Couldn't start checkout. Try again in a moment.");
        return;
      }
      window.location.href = body.url;
    } catch (e: any) {
      setBuyState("error");
      setBuyError(e?.message || "Network error. Try again.");
    }
  };

  if (profileState.status === "loading" || loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: C.muted }}>
        Loading…
      </div>
    );
  }
  if (profileState.status === "not_found") {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: C.brandText }}>
        Storefront not found.
      </div>
    );
  }
  if (error || !product) {
    return (
      <StorefrontShell
        handle={handle}
        businessName={profileState.profile.business_name}
        bannerUrl={profileState.profile.banner_image_url}
        logoUrl={profileState.profile.logo_url}
        active="shop"
      >
        <div
          className="rounded-3xl p-8 text-center"
          style={{
            background: C.paper,
            border: `1px solid ${C.brandBorder}`,
            boxShadow: SHADOWS.card,
          }}
        >
          <p style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: C.brandText }}>
            Product not found
          </p>
          <p className="mt-2 text-[13px]" style={{ color: C.muted }}>
            {error || "The link may be out of date."}
          </p>
          <button
            type="button"
            onClick={() => router.push(`/@${encodeURIComponent(handle)}/shop`)}
            className="mt-4 px-4 py-2 rounded-full text-[12px] font-bold uppercase tracking-widest"
            style={{ color: C.brandPrimary, border: `1px solid ${C.brandPrimary}`, letterSpacing: "0.12em" }}
          >
            Back to shop
          </button>
        </div>
      </StorefrontShell>
    );
  }

  return (
    <StorefrontShell
      handle={handle}
      businessName={profileState.profile.business_name}
      bannerUrl={profileState.profile.banner_image_url}
      logoUrl={profileState.profile.logo_url}
      active="shop"
    >
      {/* Gallery */}
      <section>
        <div
          className="rounded-3xl overflow-hidden relative"
          style={{
            aspectRatio: "1 / 1",
            background: C.ivory,
            border: `1px solid ${C.brandBorder}`,
            boxShadow: SHADOWS.cardLifted,
          }}
        >
          {gallery.length > 0 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={gallery[galleryIdx]}
              alt={product.title}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <div style={{ width: "100%", height: "100%", background: GRADIENTS.primary }} />
          )}
          {soldOut && (
            <span
              className="absolute top-3 left-3 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-widest"
              style={{ background: C.brandError, color: "#FFFFFF", letterSpacing: "0.12em" }}
            >
              Sold out
            </span>
          )}
        </div>

        {gallery.length > 1 && (
          <div className="flex gap-2 overflow-x-auto mt-3 bbp-no-scrollbar">
            {gallery.map((src, i) => (
              <button
                key={`${src}-${i}`}
                type="button"
                onClick={() => setGalleryIdx(i)}
                className="rounded-xl overflow-hidden shrink-0"
                style={{
                  width: 60,
                  height: 60,
                  border: `2px solid ${i === galleryIdx ? C.brandPrimary : "transparent"}`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Title + price */}
      <section className="mt-5">
        {product.category && (
          <p
            className="text-[11px] font-bold uppercase tracking-widest mb-1"
            style={{ color: C.brandPrimary, letterSpacing: "0.16em" }}
          >
            {PRODUCT_CATEGORY_LABEL[product.category]}
          </p>
        )}
        <h1
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 26,
            fontWeight: 600,
            color: C.brandText,
            lineHeight: 1.15,
          }}
        >
          {product.title}
        </h1>
        <div className="flex items-baseline gap-3 mt-2">
          <span style={{ fontSize: 22, fontWeight: 700, color: C.brandText }}>
            {fmtMoney(product.price)}
          </span>
          {onSale && (
            <span
              style={{
                fontSize: 16,
                color: C.mutedSoft,
                textDecoration: "line-through",
              }}
            >
              {fmtMoney(product.compare_at_price)}
            </span>
          )}
          {onSale && (
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest"
              style={{
                background: C.brandError,
                color: "#FFFFFF",
                letterSpacing: "0.10em",
              }}
            >
              Sale
            </span>
          )}
        </div>
        {product.inventory_count != null && (
          <p
            className="text-[12px] mt-2"
            style={{
              color: soldOut
                ? C.brandError
                : product.inventory_count <= 5
                ? "#B45309"
                : C.brandSuccess,
              fontWeight: 600,
            }}
          >
            {soldOut
              ? "Out of stock"
              : product.inventory_count <= 5
              ? `Only ${product.inventory_count} left`
              : "In stock"}
          </p>
        )}
      </section>

      {/* Buy button */}
      <section className="mt-5">
        <button
          type="button"
          onClick={startCheckout}
          disabled={soldOut || buyState === "loading"}
          className="w-full rounded-2xl px-4 py-3.5 text-[14px] font-bold uppercase tracking-widest transition active:scale-[0.98]"
          style={{
            background: soldOut ? C.brandBorder : GRADIENTS.primary,
            color: soldOut ? C.muted : "#FFFFFF",
            boxShadow: soldOut ? "none" : SHADOWS.primaryGlow,
            letterSpacing: "0.14em",
            border: 0,
            cursor: soldOut ? "not-allowed" : "pointer",
            opacity: buyState === "loading" ? 0.7 : 1,
          }}
        >
          {soldOut
            ? "Sold out"
            : buyState === "loading"
            ? "Opening checkout…"
            : product.external_checkout_url
            ? "Buy at external shop"
            : "Buy now"}
        </button>
        {buyError && (
          <p
            className="mt-2 text-[12px] text-center"
            style={{ color: C.brandError }}
          >
            {buyError}
          </p>
        )}
        {product.local_pickup_available && (
          <p
            className="mt-2 text-[11px] uppercase tracking-widest text-center"
            style={{ color: C.muted, letterSpacing: "0.14em" }}
          >
            Local pickup available
          </p>
        )}
      </section>

      {/* Description */}
      {product.description && (
        <section className="mt-6">
          <h2
            className="text-[11px] font-bold uppercase tracking-widest mb-2"
            style={{ color: C.muted, letterSpacing: "0.14em" }}
          >
            Description
          </h2>
          <p
            className="text-[14px] leading-relaxed whitespace-pre-wrap"
            style={{ color: C.coffee }}
          >
            {product.description}
          </p>
        </section>
      )}

      {/* Related */}
      {related.length > 0 && (
        <section className="mt-8">
          <h2
            className="text-[11px] font-bold uppercase tracking-widest mb-3"
            style={{ color: C.muted, letterSpacing: "0.14em" }}
          >
            You may also like
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {related.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  router.push(
                    `/@${encodeURIComponent(handle)}/products/${encodeURIComponent(p.slug)}`,
                  )
                }
                className="text-left active:scale-[0.98] transition"
              >
                <div
                  className="rounded-2xl overflow-hidden"
                  style={{
                    aspectRatio: "1 / 1",
                    background: C.ivory,
                    border: `1px solid ${C.brandBorder}`,
                    boxShadow: SHADOWS.card,
                  }}
                >
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.image_url}
                      alt={p.title}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <div style={{ width: "100%", height: "100%", background: GRADIENTS.primary }} />
                  )}
                </div>
                <p
                  className="mt-2 text-[13px] font-semibold truncate"
                  style={{ color: C.brandText }}
                >
                  {p.title}
                </p>
                <p className="text-[12px]" style={{ color: C.muted }}>
                  {fmtMoney(p.price)}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      <style jsx global>{`
        .bbp-no-scrollbar::-webkit-scrollbar { display: none; }
        .bbp-no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </StorefrontShell>
  );
}
