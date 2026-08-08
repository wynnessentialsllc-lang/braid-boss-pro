"use client";

// Interactive product gallery: a large active image + a row of thumbnail
// buttons. Catalog-driven — the product page passes `images` from
// app/lib/store-catalog.ts (hero first, then gallery), so the gallery
// stays in sync with the landing card, OG image, and Product JSON-LD.
//
// The main frame adopts each image's natural aspect ratio (measured on
// load) and uses object-contain, so a non-square graphic — like the
// sticker preview sheet (2000×1600) — is shown in full with nothing
// cropped. Square mockups (the planner) still render edge-to-edge.

import { useState } from "react";
import Image from "next/image";

export type GalleryImage = { src: string; alt: string };

export default function ProductGallery({ images }: { images: GalleryImage[] }) {
  const [active, setActive] = useState(0);
  // Aspect ratio (w/h) of the active image, measured on load. Null until
  // the first image reports its natural size; we reserve a square box in
  // the meantime so the layout doesn't jump much.
  const [ratio, setRatio] = useState<number | null>(null);
  if (!images || images.length === 0) return null;
  const current = images[Math.min(active, images.length - 1)];

  return (
    <div className="w-full">
      <div
        className="relative w-full overflow-hidden rounded-2xl border border-[#ECE7F2] bg-white"
        style={{ aspectRatio: ratio ? String(ratio) : "1 / 1" }}
      >
        <Image
          src={current.src}
          alt={current.alt}
          fill
          priority
          sizes="(max-width: 860px) 100vw, 50vw"
          className="object-contain"
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) {
              setRatio(img.naturalWidth / img.naturalHeight);
            }
          }}
        />
      </div>

      {images.length > 1 && (
        <div
          className="mt-4 grid gap-3"
          style={{ gridTemplateColumns: `repeat(${Math.min(images.length, 6)}, minmax(0, 1fr))` }}
        >
          {images.map((img, i) => (
            <button
              key={img.src}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`View image ${i + 1}: ${img.alt}`}
              aria-current={i === active}
              className={`relative aspect-square overflow-hidden rounded-lg border-2 bg-white transition ${
                i === active ? "border-[#7C3AED]" : "border-transparent hover:border-[#ECE7F2]"
              }`}
            >
              <Image src={img.src} alt="" fill sizes="120px" className="object-contain" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
