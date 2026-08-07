"use client";

// Digital-product file uploader for the storefront commerce admin.
//
// A single-file picker for the downloadable asset (an ebook / PDF / care
// guide) a braider sells. Uploads run through uploadProductFile into the
// PRIVATE `product-files` bucket; the buyer never sees the object path —
// after a paid order they get a short-lived signed URL from
// /api/product-download.
//
// State is the (path, fileName) pair the product row stores. onChange is
// called with both, or (null, null) when the file is removed. Mirrors
// ProductImageUploader's token API so it matches the host palette.

import { useRef, useState } from "react";
import {
  uploadProductFile,
  removeProductFile,
  DIGITAL_FILE_MAX_MB,
} from "../lib/product-file-storage";

type Tokens = {
  border: string;
  muted: string;
  error: string;
  primary: string;
  paper: string;
};

const defaultTokens: Tokens = {
  border: "#ECE7F2",
  muted: "#6F6477",
  error: "#EF4444",
  primary: "#7C3AED",
  paper: "#FFFFFF",
};

export const ProductFileUploader = (props: {
  userId: string | null;
  path: string | null;
  fileName: string | null;
  onChange: (path: string | null, fileName: string | null) => void;
  tokens?: Tokens;
  disabled?: boolean;
}) => {
  const tokens = props.tokens || defaultTokens;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const triggerPicker = () => {
    if (props.disabled || busy) return;
    setErr(null);
    inputRef.current?.click();
  };

  const handleFile = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!props.userId) {
      setErr("Sign in required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const prior = props.path;
      const result = await uploadProductFile(props.userId, files[0]);
      if (!result.ok) {
        setErr(result.error);
        return;
      }
      props.onChange(result.path, result.fileName);
      // Best-effort cleanup of the file we just replaced — the row now
      // points at the new object, so an orphan only costs a little storage.
      if (prior && prior !== result.path) removeProductFile(prior);
    } catch (e: any) {
      setErr(e?.message || "Upload failed.");
    } finally {
      setBusy(false);
      // Reset so re-picking the same file still fires onChange.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = () => {
    const prior = props.path;
    props.onChange(null, null);
    if (prior) removeProductFile(prior);
  };

  const boxBase = {
    borderRadius: 14,
    border: `1px dashed ${tokens.border}`,
    background: tokens.paper,
    padding: 14,
    color: tokens.muted,
    fontSize: 12,
    cursor: props.disabled ? "not-allowed" : "pointer",
    width: "100%",
    textAlign: "left" as const,
  };

  return (
    <div>
      {props.path ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            borderRadius: 14,
            border: `1px solid ${tokens.border}`,
            background: tokens.paper,
            padding: 12,
          }}
        >
          <div
            aria-hidden
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: `${tokens.primary}14`,
              color: tokens.primary,
              fontSize: 18,
            }}
          >
            📄
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#15111A",
                margin: 0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {props.fileName || "Uploaded file"}
            </p>
            <p style={{ fontSize: 11, color: tokens.muted, margin: "2px 0 0" }}>
              Delivered as a secure download after purchase.
            </p>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              onClick={triggerPicker}
              disabled={props.disabled || busy}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: `1px solid ${tokens.border}`,
                background: "transparent",
                color: tokens.muted,
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {busy ? "Uploading…" : "Replace"}
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={props.disabled || busy}
              aria-label="Remove file"
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: `1px solid ${tokens.border}`,
                background: "transparent",
                color: tokens.error,
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={triggerPicker}
          disabled={props.disabled || busy}
          style={boxBase}
        >
          {busy ? (
            "Uploading…"
          ) : (
            <span>
              <span style={{ fontWeight: 700, color: tokens.primary }}>＋ Upload file</span>
              <span style={{ display: "block", marginTop: 2 }}>
                PDF, EPUB, MOBI, or ZIP · up to {DIGITAL_FILE_MAX_MB} MB
              </span>
            </span>
          )}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.epub,.mobi,.zip,application/pdf,application/epub+zip,application/x-mobipocket-ebook,application/zip"
        onChange={(e) => handleFile(e.target.files)}
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
