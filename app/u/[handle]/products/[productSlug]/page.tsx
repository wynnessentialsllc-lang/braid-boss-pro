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
import { useCart } from "../../../../lib/cart";
import {
  effectiveInventory,
  effectiveLowStockThreshold,
  effectivePrice,
  effectiveCompareAtPrice,
  effectiveImageUrl,
} from "../../../../lib/storefront";
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
  const { addItem, openCart } = useCart();
  // 'Added!' flash on the Add-to-cart button for confidence after
  // tap. Resets after a short delay so subsequent taps still react.
  const [addedFlash, setAddedFlash] = useState(false);

  const [product, setProduct] = useState<PublicProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [related, setRelated] = useState<PublicProduct[]>([]);

  // Gallery state — index into [image_url, ...gallery_images] with
  // duplicate-filtering to handle products that re-use the featured
  // image as the first gallery image.
  const [galleryIdx, setGalleryIdx] = useState(0);

  // Checkout button state
  const [buyState, setBuyState] = useState<"idle" | "loading" | "error">("idle");
  const [buyError, setBuyError] = useState<string | null>(null);
  // Selected variant id — null when the product has no variants
  // (legacy or single-option), or when none has been picked yet.
  // The Buy button stays disabled until a pick is made for any
  // product that declares variants.
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  // Gift-card buyer-chosen amount (only when the product allows it).
  const [customAmount, setCustomAmount] = useState("");
  const customAllowed = !!product?.is_gift_card && !!product?.gift_card_allow_custom;
  const customMode = customAllowed && customAmount.trim().length > 0;
  const customAmountNum = customAmount.trim() ? Number(customAmount.trim()) : null;
  const customAmountValid =
    customAmountNum != null && Number.isFinite(customAmountNum) &&
    customAmountNum >= 10 && customAmountNum <= 200;
  const hasVariants = (product?.variants?.length || 0) > 0;
  // A buyer-chosen amount stands in for the variant pick.
  const needsVariantPick = hasVariants && !selectedVariantId && !customMode;
  const selectedVariant = useMemo(
    () =>
      product?.variants?.find((v) => v.id === selectedVariantId) ?? null,
    [product, selectedVariantId],
  );

  // Effective values — variant overrides win when set, else product-
  // level. Recompute when the selected variant changes so the price /
  // image / sold-out state swap immediately.
  const effPrice = useMemo(
    () => effectivePrice(product?.price, selectedVariant),
    [product, selectedVariant],
  );
  const effCompareAt = useMemo(
    () => effectiveCompareAtPrice(product?.compare_at_price, selectedVariant),
    [product, selectedVariant],
  );
  const effImage = useMemo(
    () => effectiveImageUrl(product?.image_url, selectedVariant),
    [product, selectedVariant],
  );
  const effStock = useMemo(
    () => effectiveInventory(product?.inventory_count, selectedVariant),
    [product, selectedVariant],
  );

  // Gallery — variant image swap when present, then the variant
  // image plus the product gallery, deduped. The featured product
  // image stays in the deck so the visitor can see the generic
  // hero shot even after picking a variant with its own photo.
  const gallery = useMemo(() => {
    if (!product) return [] as string[];
    const all = [effImage, product.image_url, ...product.gallery_images].filter(
      (s): s is string => !!s && s.trim().length > 0,
    );
    return Array.from(new Set(all));
  }, [product, effImage]);

  const onSale =
    effPrice != null && effCompareAt != null && effCompareAt > effPrice;
  const soldOut = effStock != null && effStock <= 0;
  const lowStockThreshold = effectiveLowStockThreshold(selectedVariant);
  const isLowStock =
    effStock != null && effStock > 0 && effStock <= lowStockThreshold;

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
    if (needsVariantPick) {
      // Defensive — the Buy button is already disabled when this
      // guard is true, but a keyboard user could still fire onClick.
      setBuyState("error");
      setBuyError(`Pick ${product.variant_label || "an option"} first.`);
      return;
    }
    if (customMode && !customAmountValid) {
      setBuyState("error");
      setBuyError("Enter a gift card amount between $10 and $200.");
      return;
    }
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
          // Variant pick — only set when the product declares a
          // variants list. The checkout API validates the id
          // against the product's variants jsonb and surfaces the
          // chosen variant in line_items + Stripe metadata.
          variant_id: customMode ? null : selectedVariantId,
          // Gift-card buyer-chosen amount. The checkout API validates
          // it against the $10-$200 range for gift-card products.
          custom_amount: customMode ? customAmountNum : null,
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
            {fmtMoney(effPrice)}
          </span>
          {onSale && (
            <span
              style={{
                fontSize: 16,
                color: C.mutedSoft,
                textDecoration: "line-through",
              }}
            >
              {fmtMoney(effCompareAt)}
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
        {effStock != null && (
          <p
            className="text-[12px] mt-2"
            style={{
              color: soldOut
                ? C.brandError
                : isLowStock
                ? "#B45309"
                : C.brandSuccess,
              fontWeight: 600,
            }}
          >
            {soldOut
              ? "Out of stock"
              : isLowStock
              ? `Only ${effStock} left`
              : "In stock"}
          </p>
        )}
      </section>

      {/* Variant picker — only renders for products that declare a
          variants list. Single-tap chips: tapping a chip selects
          that variant; selected variant carries through to the
          Buy Now POST body. Picker reads as a horizontal scroll
          chip row so a 6+ color set still fits on a phone. */}
      {hasVariants && (
        <section className="mt-5">
          <p
            className="text-[11px] font-bold uppercase tracking-widest mb-2"
            style={{ color: C.muted, letterSpacing: "0.14em" }}
          >
            {product.variant_label || "Options"}
          </p>
          <div
            role="radiogroup"
            aria-label={product.variant_label || "Options"}
            className="flex flex-wrap gap-2"
          >
            {product.variants.map((v) => {
              const isActive = selectedVariantId === v.id;
              // Per-variant inventory + low-stock from the variant
              // itself, falling back to the product-level count when
              // the variant has no override. Sold-out variants stay
              // tappable so the customer can see what's missing —
              // but the Buy / Add-to-cart buttons gate on the
              // selected variant's stock below.
              const vStock = effectiveInventory(product.inventory_count, v);
              const vThreshold = effectiveLowStockThreshold(v);
              const vSoldOut = vStock != null && vStock <= 0;
              const vLowStock = vStock != null && vStock > 0 && vStock <= vThreshold;
              return (
                <button
                  key={v.id}
                  role="radio"
                  aria-checked={isActive}
                  type="button"
                  onClick={() => { setSelectedVariantId(v.id); setGalleryIdx(0); }}
                  disabled={vSoldOut}
                  className="px-3.5 py-2 rounded-full text-[13px] font-semibold transition active:scale-[0.97]"
                  style={{
                    background: isActive
                      ? GRADIENTS.primary
                      : vSoldOut
                        ? C.brandBorder
                        : C.paper,
                    color: isActive
                      ? "#FFFFFF"
                      : vSoldOut
                        ? C.mutedSoft
                        : C.brandText,
                    border: `1.5px solid ${isActive ? "transparent" : C.brandBorder}`,
                    boxShadow: isActive ? SHADOWS.primaryGlow : "none",
                    textDecoration: vSoldOut ? "line-through" : "none",
                    cursor: vSoldOut ? "not-allowed" : "pointer",
                    opacity: vSoldOut ? 0.7 : 1,
                  }}
                  aria-label={`${v.name}${vSoldOut ? " (sold out)" : vLowStock ? ` (only ${vStock} left)` : ""}`}
                >
                  {v.name}
                  {vSoldOut && (
                    <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, letterSpacing: "0.10em" }}>
                      · SOLD OUT
                    </span>
                  )}
                  {!vSoldOut && vLowStock && (
                    <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: isActive ? "#FFFFFF" : "#B45309" }}>
                      · {vStock} LEFT
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {needsVariantPick && (
            <p
              className="text-[11px] mt-2"
              style={{ color: C.muted }}
            >
              Pick {product.variant_label?.toLowerCase() || "an option"} to continue.
            </p>
          )}
        </section>
      )}

      {/* Gift-card "Other amount" — buyer-chosen value, $10–$200.
          Custom amounts check out directly (Buy now), not via cart. */}
      {customAllowed && (
        <section className="mt-5">
          <p
            className="text-[11px] font-bold uppercase tracking-widest mb-2"
            style={{ color: C.muted, letterSpacing: "0.14em" }}
          >
            Other amount
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[16px] font-bold" style={{ color: C.brandText }}>$</span>
            <input
              type="number"
              inputMode="decimal"
              min={10}
              max={200}
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              placeholder="Enter $10–$200"
              className="flex-1 rounded-2xl px-4 py-3 text-[15px]"
              style={{
                background: C.paper,
                border: `1.5px solid ${C.brandBorder}`,
                color: C.brandText,
                outline: "none",
              }}
            />
          </div>
          {customAmount.trim() && !customAmountValid && (
            <p className="text-[11px] mt-2" style={{ color: C.brandError }}>
              Amount must be between $10 and $200.
            </p>
          )}
          {customMode && customAmountValid && (
            <p className="text-[11px] mt-2" style={{ color: C.muted }}>
              Tap Buy now for a ${customAmountNum} gift card — custom amounts check out directly, not via cart.
            </p>
          )}
        </section>
      )}

      {/* Buy / Add-to-cart row. Buy Now stays the primary action
          (gradient + glow); Add to cart is the outline secondary
          for visitors browsing multiple products before checkout.
          Both share the variant-pick gate. */}
      <section className="mt-5">
        <button
          type="button"
          onClick={() => {
            if (soldOut || needsVariantPick || customMode || !product) return;
            if (product.external_checkout_url) {
              window.location.href = product.external_checkout_url;
              return;
            }
            const variant = product.variants.find((v) => v.id === selectedVariantId);
            addItem(
              {
                product_id: product.id,
                product_slug: product.slug,
                title: product.title,
                // Variant overrides flow into the cart so the drawer
                // + checkout API + Stripe receipt all show the
                // picked variant's price / image / stock ceiling.
                image_url: effImage,
                unit_amount: Number(effPrice ?? product.price ?? 0),
                inventory_count: effStock,
                variant_id: variant?.id || null,
                variant_label: variant ? product.variant_label : null,
                variant_name: variant?.name || null,
                requires_shipping: product.requires_shipping,
              },
              handle,
            );
            setAddedFlash(true);
            window.setTimeout(() => setAddedFlash(false), 1500);
          }}
          disabled={soldOut || needsVariantPick || customMode || !!product.external_checkout_url}
          className="w-full rounded-2xl px-4 py-3 text-[13px] font-bold uppercase tracking-widest transition active:scale-[0.98] mb-2"
          style={{
            background: "transparent",
            color: (soldOut || needsVariantPick) ? C.mutedSoft : C.brandPrimary,
            border: `1.5px solid ${(soldOut || needsVariantPick) ? C.brandBorder : C.brandPrimary}`,
            letterSpacing: "0.14em",
            cursor: (soldOut || needsVariantPick || !!product.external_checkout_url) ? "not-allowed" : "pointer",
            opacity: addedFlash ? 0.7 : 1,
          }}
        >
          {addedFlash
            ? "Added to cart ✓"
            : product.external_checkout_url
            ? "External checkout only"
            : "Add to cart"}
        </button>
        <button
          type="button"
          onClick={startCheckout}
          disabled={soldOut || buyState === "loading" || needsVariantPick || (customMode && !customAmountValid)}
          className="w-full rounded-2xl px-4 py-3.5 text-[14px] font-bold uppercase tracking-widest transition active:scale-[0.98]"
          style={{
            background: (soldOut || needsVariantPick) ? C.brandBorder : GRADIENTS.primary,
            color: (soldOut || needsVariantPick) ? C.muted : "#FFFFFF",
            boxShadow: (soldOut || needsVariantPick) ? "none" : SHADOWS.primaryGlow,
            letterSpacing: "0.14em",
            border: 0,
            cursor: (soldOut || needsVariantPick) ? "not-allowed" : "pointer",
            opacity: buyState === "loading" ? 0.7 : 1,
          }}
        >
          {soldOut
            ? "Sold out"
            : needsVariantPick
            ? `Pick ${product.variant_label?.toLowerCase() || "option"}`
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
