// Product visual for the Braid Boss Pro Store.
//
// Renders the product's real image when one is set in the catalog, and a
// tasteful, on-brand placeholder (gradient + icon + name) when it isn't —
// so the storefront looks finished before final photography lands. Pure
// presentational, no hooks, safe in a server component.

import { NotebookPen } from "lucide-react";
import { C, GRADIENTS, FONT_DISPLAY } from "../../components/marketing/tokens";
import type { StoreProduct } from "../../lib/store-catalog";

export const StoreVisual = ({
  product,
  rounded = 24,
  minHeight = 280,
  showLabel = true,
}: {
  product: Pick<StoreProduct, "name" | "image" | "category">;
  rounded?: number;
  minHeight?: number;
  showLabel?: boolean;
}) => {
  if (product.image) {
    // Fixed square frame + object-contain: every product tile renders at
    // the SAME size regardless of the source image's aspect ratio (square
    // planner mockups, wide sticker sheets), and nothing is ever cropped —
    // non-square art is letterboxed on a neutral background instead.
    return (
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1 / 1",
          minHeight,
          borderRadius: rounded,
          overflow: "hidden",
          border: `1px solid ${C.brandBorder}`,
          background: "#FFFFFF",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- catalog images may be local /public paths or remote; plain img keeps the store dependency-free */}
        <img
          src={product.image}
          alt={product.name}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
        />
      </div>
    );
  }

  // Branded placeholder.
  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        overflow: "hidden",
        minHeight,
        borderRadius: rounded,
        background: GRADIENTS.softA,
        border: `1px solid ${C.brandBorder}`,
        display: "grid",
        placeItems: "center",
        textAlign: "center",
        padding: 28,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: -80,
          background:
            "conic-gradient(from 210deg, rgba(124,58,237,0.16), rgba(255,77,109,0.16), rgba(177,75,224,0.16), rgba(124,58,237,0.16))",
          filter: "blur(70px)",
          opacity: 0.7,
        }}
      />
      <div style={{ position: "relative" }}>
        <div
          style={{
            width: 72,
            height: 72,
            margin: "0 auto 14px",
            borderRadius: 20,
            background: "#FFFFFF",
            border: `1px solid ${C.brandBorder}`,
            display: "grid",
            placeItems: "center",
            boxShadow: "0 10px 28px -14px rgba(124,58,237,0.4)",
          }}
        >
          <NotebookPen size={34} style={{ color: C.brandPrimary }} />
        </div>
        {showLabel && (
          <>
            <p
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 22,
                fontWeight: 600,
                color: C.ink,
                margin: 0,
                lineHeight: 1.1,
              }}
            >
              {product.name}
            </p>
            <p
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: C.brandPrimary,
                marginTop: 8,
              }}
            >
              {product.category}
            </p>
          </>
        )}
      </div>
    </div>
  );
};
