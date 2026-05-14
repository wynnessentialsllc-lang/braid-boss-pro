"use client";

// Storefront product image uploader. Two modes:
//
//   • single — replaces a featured image. Renders a thumbnail when
//     a URL is set, otherwise a tap-to-upload tile.
//
//   • multi  — appends to a gallery URL array. Renders existing
//     thumbnails with per-tile remove buttons + a final "+" tile
//     that opens the file picker. Multiple files can be selected in
//     one open and they upload in parallel.
//
// All uploads run through uploadProductImage which compresses
// client-side to a max long-side of 1600px JPEG before hitting
// Supabase Storage.

import { useRef, useState } from "react";
import { uploadProductImage, removeProductImage } from "../lib/product-images-storage";

type CommonProps = {
  userId: string | null;
  // Color tokens passed in so the uploader matches whatever palette
  // the host screen uses without re-importing the admin shell C.
  tokens?: {
    border: string;
    muted: string;
    error: string;
    primary: string;
    paper: string;
  };
  disabled?: boolean;
};

const defaultTokens = {
  border: "#ECE7F2",
  muted: "#6F6477",
  error: "#EF4444",
  primary: "#7C3AED",
  paper: "#FFFFFF",
};

export const ProductImageUploader = (
  props: CommonProps &
    (
      | { mode: "single"; value: string | null; onChange: (url: string | null) => void }
      | { mode: "multi"; value: string[]; onChange: (urls: string[]) => void }
    ),
) => {
  const tokens = props.tokens || defaultTokens;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const triggerPicker = () => {
    if (props.disabled || busy) return;
    setErr(null);
    inputRef.current?.click();
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!props.userId) {
      setErr("Sign in required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      // Upload in parallel — Supabase Storage handles concurrency fine
      // and uploads tend to be I/O bound so this dramatically improves
      // the multi-pick path on a phone with several gallery photos.
      const list = Array.from(files);
      const results = await Promise.all(list.map((f) => uploadProductImage(props.userId!, f)));
      if (props.mode === "single") {
        // Single mode keeps the last picked file. If the field already
        // had a value, leave the prior image in storage — orphan cost
        // is negligible vs. the risk of removing an image the stylist
        // is still using on another product (we don't track refs).
        props.onChange(results[results.length - 1].publicUrl);
      } else {
        props.onChange([...props.value, ...results.map((r) => r.publicUrl)]);
      }
    } catch (e: any) {
      setErr(e?.message || "Upload failed.");
    } finally {
      setBusy(false);
      // Reset the input so picking the same file again still fires
      // onChange (browsers suppress the event when the value matches).
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removeAt = async (index: number) => {
    if (props.mode === "multi") {
      const url = props.value[index];
      props.onChange(props.value.filter((_, i) => i !== index));
      // Best-effort storage cleanup; we already removed the URL from
      // the form so a failure here doesn't block save.
      removeProductImage(url);
    } else {
      const url = props.value;
      props.onChange(null);
      if (url) removeProductImage(url);
    }
  };

  // ---- Rendering -------------------------------------------------------

  const tileBase = {
    width: 84,
    height: 84,
    borderRadius: 14,
    border: `1px dashed ${tokens.border}`,
    background: tokens.paper,
    display: "grid",
    placeItems: "center",
    color: tokens.muted,
    fontSize: 11,
    fontWeight: 600,
    textAlign: "center" as const,
    cursor: props.disabled ? "not-allowed" : "pointer",
    overflow: "hidden",
    position: "relative" as const,
  };

  const renderThumb = (url: string, i: number, removable: boolean) => (
    <div key={`${url}-${i}`} style={{ ...tileBase, border: `1px solid ${tokens.border}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      {removable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            removeAt(i);
          }}
          aria-label="Remove image"
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            width: 22,
            height: 22,
            borderRadius: 999,
            background: "rgba(21, 17, 26, 0.72)",
            color: "#FFFFFF",
            border: 0,
            fontSize: 12,
            lineHeight: 1,
            cursor: "pointer",
          }}
        >
          ×
        </button>
      )}
    </div>
  );

  const addTile = (
    <button
      type="button"
      onClick={triggerPicker}
      disabled={props.disabled || busy}
      style={tileBase}
      aria-label="Upload image"
    >
      {busy ? "Uploading…" : (
        <span style={{ lineHeight: 1.2 }}>
          <span style={{ display: "block", fontSize: 22, marginBottom: 2 }}>＋</span>
          Add photo
        </span>
      )}
    </button>
  );

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {props.mode === "single" ? (
          props.value ? (
            <>
              {renderThumb(props.value, 0, true)}
              <button
                type="button"
                onClick={triggerPicker}
                disabled={props.disabled || busy}
                style={{
                  ...tileBase,
                  width: 100,
                  fontSize: 11,
                }}
              >
                {busy ? "Uploading…" : "Replace"}
              </button>
            </>
          ) : (
            addTile
          )
        ) : (
          <>
            {props.value.map((u, i) => renderThumb(u, i, true))}
            {addTile}
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={props.mode === "multi"}
        onChange={(e) => handleFiles(e.target.files)}
        style={{ display: "none" }}
      />
      {err && (
        <p className="mt-2 text-[11px]" style={{ color: tokens.error }}>
          {err}
        </p>
      )}
    </div>
  );
};
