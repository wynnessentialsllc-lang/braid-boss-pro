"use client";

// Public shop at /@handle/shop. Lists every active product for the
// stylist with category-pill filtering, a "Featured" rail at the
// top, and a 2-col product grid below. Tapping a card routes to
// /@handle/products/<slug>.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  StorefrontShell,
  C,
  GRADIENTS,
  SHADOWS,
  FONT_DISPLAY,
  fmtMoney,
} from "../_components/StorefrontShell";
import { useStylistProfile } from "../_components/useStylistProfile";
import {
  fetchPublicProducts,
  PRODUCT_CATEGORIES,
  PRODUCT_CATEGORY_LABEL,
  type PublicProduct,
  type ProductCategory,
} from "../../../lib/storefront";

type CategoryFilter = "all" | ProductCategory;

export default function StylistShopPage() {
  const params = useParams();
  const router = useRouter();
  const handle = useMemo(() => {
    const raw = params?.handle;
    const v = Array.isArray(raw) ? raw[0] : raw || "";
    return decodeURIComponent(v).replace(/^@/, "");
  }, [params]);

  const profileState = useStylistProfile(handle);

  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CategoryFilter>("all");

  useEffect(() => {
    if (profileState.status !== "ready") return;
    let cancelled = false;
    (async () => {
      setProductsLoading(true);
      const r = await fetchPublicProducts(profileState.profile.slug);
      if (cancelled) return;
      if (!r.ok) {
        setProductsError(r.error);
        setProducts([]);
      } else {
        setProductsError(null);
        setProducts(r.products);
      }
      setProductsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [profileState.status, profileState.status === "ready" ? profileState.profile.slug : ""]);

  // Shop turned off: send old links (an Instagram bio, a shared
  // screenshot) to the booking page instead of a storefront the braider
  // has opted out of. replace() so Back returns where they came from,
  // matching how /@handle itself bounces.
  const shopHidden = profileState.status === "ready" && profileState.profile.shop_hidden;
  const bookingSlug = profileState.status === "ready" ? profileState.profile.slug : "";
  useEffect(() => {
    if (!shopHidden || !bookingSlug) return;
    router.replace(`/book/${encodeURIComponent(bookingSlug)}`);
  }, [shopHidden, bookingSlug, router]);

  // Build the category set the stylist actually has products in,
  // so the filter row only shows pills that have content. Always
  // include "All" first.
  const availableCategories = useMemo<CategoryFilter[]>(() => {
    const present = new Set<ProductCategory>();
    for (const p of products) {
      if (p.category) present.add(p.category);
    }
    return ["all", ...PRODUCT_CATEGORIES.filter((c) => present.has(c))];
  }, [products]);

  const featured = useMemo(() => products.filter((p) => p.is_featured), [products]);
  const visible = useMemo(
    () => (filter === "all" ? products : products.filter((p) => p.category === filter)),
    [products, filter],
  );

  if (profileState.status === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: C.muted }}>
        Loading…
      </div>
    );
  }
  if (profileState.status === "not_found") {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, color: C.brandText }}>
        <p>Storefront not found.</p>
      </div>
    );
  }
  // Bounce in flight (see the effect above) — don't flash the grid.
  if (shopHidden) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: C.muted }}>
        Taking you to the booking page…
      </div>
    );
  }

  return (
    <StorefrontShell
      handle={handle}
      businessName={profileState.profile.shop_name || profileState.profile.business_name}
      description={profileState.profile.shop_description}
      bannerUrl={profileState.profile.shop_banner_url || profileState.profile.banner_image_url}
      logoUrl={profileState.profile.shop_logo_url || profileState.profile.logo_url}
      shopHidden={profileState.profile.shop_hidden}
      active="shop"
    >
      {productsLoading ? (
        <ProductGridSkeleton />
      ) : productsError ? (
        <EmptyState
          title="Couldn't load the shop"
          body={productsError}
        />
      ) : products.length === 0 ? (
        <EmptyState
          title="Shop coming soon"
          body="This stylist hasn't added any products yet — check back soon."
        />
      ) : (
        <>
          {/* Featured rail — horizontal scroll for screen real estate */}
          {featured.length > 0 && (
            <section className="mb-6">
              <h2
                className="text-[11px] font-bold uppercase tracking-widest mb-3"
                style={{ color: C.muted, letterSpacing: "0.16em" }}
              >
                Featured
              </h2>
              <div className="flex gap-3 overflow-x-auto -mx-5 px-5 pb-1 bbp-no-scrollbar">
                {featured.map((p) => (
                  <FeaturedCard
                    key={p.id}
                    product={p}
                    onTap={() =>
                      router.push(
                        `/@${encodeURIComponent(handle)}/products/${encodeURIComponent(p.slug)}`,
                      )
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {/* Category pills */}
          {availableCategories.length > 1 && (
            <nav className="flex gap-2 overflow-x-auto -mx-5 px-5 pb-3 bbp-no-scrollbar">
              {availableCategories.map((c) => {
                const isActive = c === filter;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setFilter(c)}
                    className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-bold uppercase tracking-widest transition"
                    style={{
                      background: isActive ? GRADIENTS.primary : "transparent",
                      color: isActive ? "#FFFFFF" : C.muted,
                      border: `1px solid ${isActive ? "transparent" : C.brandBorder}`,
                      letterSpacing: "0.10em",
                      boxShadow: isActive ? SHADOWS.primaryGlow : "none",
                    }}
                  >
                    {c === "all" ? "All" : PRODUCT_CATEGORY_LABEL[c]}
                  </button>
                );
              })}
            </nav>
          )}

          {/* Product grid */}
          <section className="grid grid-cols-2 gap-3 mt-2">
            {visible.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                onTap={() =>
                  router.push(
                    `/@${encodeURIComponent(handle)}/products/${encodeURIComponent(p.slug)}`,
                  )
                }
              />
            ))}
            {visible.length === 0 && (
              <p
                style={{ color: C.muted, gridColumn: "1 / -1", textAlign: "center" }}
                className="text-[13px] py-6"
              >
                No products in this category yet.
              </p>
            )}
          </section>
        </>
      )}

      <style jsx global>{`
        .bbp-no-scrollbar::-webkit-scrollbar { display: none; }
        .bbp-no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </StorefrontShell>
  );
}

// ---- Cards ---------------------------------------------------------------

const FeaturedCard = ({
  product,
  onTap,
}: {
  product: PublicProduct;
  onTap: () => void;
}) => {
  const soldOut = product.inventory_count != null && product.inventory_count <= 0;
  return (
    <button
      type="button"
      onClick={onTap}
      className="shrink-0 text-left active:scale-[0.98] transition"
      style={{
        width: 220,
      }}
    >
      <div
        className="rounded-2xl overflow-hidden relative"
        style={{
          height: 220,
          background: C.ivory,
          border: `1px solid ${C.brandBorder}`,
          boxShadow: SHADOWS.card,
        }}
      >
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image_url}
            alt={product.title}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div style={{ width: "100%", height: "100%", background: GRADIENTS.primary }} />
        )}
        {soldOut && <Badge label="Sold out" tone="danger" />}
        {!soldOut &&
          product.inventory_count != null &&
          product.inventory_count <= 5 && <Badge label="Low stock" tone="warning" />}
      </div>
      <p
        className="mt-2 text-[14px] font-semibold truncate"
        style={{ color: C.brandText, fontFamily: FONT_DISPLAY }}
      >
        {product.title}
      </p>
      <PriceLine product={product} />
    </button>
  );
};

const ProductCard = ({
  product,
  onTap,
}: {
  product: PublicProduct;
  onTap: () => void;
}) => {
  const soldOut = product.inventory_count != null && product.inventory_count <= 0;
  return (
    <button
      type="button"
      onClick={onTap}
      className="text-left active:scale-[0.98] transition"
    >
      <div
        className="rounded-2xl overflow-hidden relative"
        style={{
          aspectRatio: "1 / 1",
          background: C.ivory,
          border: `1px solid ${C.brandBorder}`,
          boxShadow: SHADOWS.card,
        }}
      >
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image_url}
            alt={product.title}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div style={{ width: "100%", height: "100%", background: GRADIENTS.primary }} />
        )}
        {soldOut && <Badge label="Sold out" tone="danger" />}
        {!soldOut &&
          product.inventory_count != null &&
          product.inventory_count <= 5 && <Badge label="Low stock" tone="warning" />}
      </div>
      <p
        className="mt-2 text-[13px] font-semibold truncate"
        style={{ color: C.brandText }}
      >
        {product.title}
      </p>
      <PriceLine product={product} compact />
    </button>
  );
};

const PriceLine = ({
  product,
  compact,
}: {
  product: PublicProduct;
  compact?: boolean;
}) => {
  const onSale =
    product.price != null &&
    product.compare_at_price != null &&
    product.compare_at_price > product.price;
  const size = compact ? 12 : 13;
  return (
    <div className="flex items-baseline gap-2 mt-0.5">
      <span style={{ fontSize: size, fontWeight: 700, color: C.brandText }}>
        {fmtMoney(product.price)}
      </span>
      {onSale && (
        <span
          style={{
            fontSize: size - 1,
            color: C.mutedSoft,
            textDecoration: "line-through",
          }}
        >
          {fmtMoney(product.compare_at_price)}
        </span>
      )}
    </div>
  );
};

const Badge = ({
  label,
  tone,
}: {
  label: string;
  tone: "danger" | "warning";
}) => (
  <span
    className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest"
    style={{
      background: tone === "danger" ? C.brandError : C.brandWarning,
      color: tone === "danger" ? "#FFFFFF" : "#15111A",
      letterSpacing: "0.10em",
    }}
  >
    {label}
  </span>
);

const ProductGridSkeleton = () => (
  <div className="grid grid-cols-2 gap-3">
    {[0, 1, 2, 3].map((i) => (
      <div
        key={i}
        className="rounded-2xl"
        style={{
          aspectRatio: "1 / 1",
          background: C.ivory,
          border: `1px solid ${C.brandBorder}`,
        }}
      />
    ))}
  </div>
);

const EmptyState = ({ title, body }: { title: string; body: string }) => (
  <div
    className="rounded-3xl p-8 text-center"
    style={{
      background: C.paper,
      border: `1px solid ${C.brandBorder}`,
      boxShadow: SHADOWS.card,
    }}
  >
    <p
      style={{
        fontFamily: FONT_DISPLAY,
        fontSize: 22,
        fontWeight: 600,
        color: C.brandText,
      }}
    >
      {title}
    </p>
    <p className="mt-2 text-[13px]" style={{ color: C.muted }}>
      {body}
    </p>
  </div>
);
