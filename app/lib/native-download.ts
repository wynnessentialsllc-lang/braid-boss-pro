// Native-aware file download.
//
// Web: builds a Blob and triggers an <a download> click, then revokes
// the object URL. Same UX every browser the PWA already supports.
//
// Capacitor (iOS / Android shell): writes the file to the Cache
// directory via @capacitor/filesystem, then opens the system share
// sheet via @capacitor/share so the user can save to Files, Photos,
// AirDrop, Messages, etc. WKWebView ignores `<a download>` so the
// web path silently no-ops there.
//
// Supports JSON / PDF / ICS / arbitrary text/binary payloads. Pass
// either a string (treated as utf-8 text) or a Blob/Uint8Array.

const isDev = process.env.NODE_ENV !== "production";

const warn = (...args: unknown[]) => {
  if (isDev && typeof console !== "undefined") {
    // eslint-disable-next-line no-console
    console.warn("[native-download]", ...args);
  }
};

export type DownloadPayload = string | Blob | Uint8Array | ArrayBuffer;

export type DownloadInput = {
  filename: string;
  mimeType: string;
  data: DownloadPayload;
  // When set, the share sheet's title/body uses this on iOS. Defaults
  // to filename.
  shareTitle?: string;
};

export type DownloadResult =
  | { ok: true; via: "web" | "native" }
  | { ok: false; error: string };

// Fast/safe Capacitor detection. We require BOTH the runtime guard
// and the actual Capacitor.isNativePlatform() check so a stray
// import on the web bundle can never report "native". The dynamic
// imports below also keep web bundle size unchanged for non-native
// users — the native plugins are only fetched when actually needed.
const isNative = (): boolean => {
  try {
    if (typeof window === "undefined") return false;
    // Read off the global injected by Capacitor at runtime. This
    // avoids importing @capacitor/core at module top-level (which
    // would pull native code into the web bundle even when unused).
    const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
    return !!w.Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("expected string result"));
        return;
      }
      // result is "data:<mime>;base64,<b64>"
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.readAsDataURL(blob);
  });

const toBlob = (data: DownloadPayload, mimeType: string): Blob => {
  if (data instanceof Blob) return data;
  if (data instanceof Uint8Array) {
    return new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer], { type: mimeType });
  }
  if (data instanceof ArrayBuffer) return new Blob([data], { type: mimeType });
  return new Blob([data], { type: mimeType });
};

const downloadOnWeb = (filename: string, mimeType: string, data: DownloadPayload): DownloadResult => {
  try {
    if (typeof document === "undefined" || typeof URL === "undefined") {
      return { ok: false, error: "browser APIs unavailable" };
    }
    const blob = toBlob(data, mimeType);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    // Anchor must be in the DOM in some browsers for the click to
    // actually trigger a download.
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on next tick so the click has a chance to start the
    // download before the URL is torn down.
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }, 0);
    return { ok: true, via: "web" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn("web download failed:", msg);
    return { ok: false, error: msg };
  }
};

const downloadOnNative = async (
  filename: string,
  mimeType: string,
  data: DownloadPayload,
  shareTitle: string,
): Promise<DownloadResult> => {
  try {
    // Lazy-load so the web bundle never pulls these.
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/share"),
    ]);

    const blob = toBlob(data, mimeType);
    const base64 = await blobToBase64(blob);

    const written = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
      // No `encoding` field → Filesystem treats data as base64. This
      // matters: writing utf-8 with the wrong encoding corrupts PDFs.
    });

    const result = await Share.share({
      title: shareTitle || filename,
      // `text` is the message preview the user sees on the share sheet
      // (e.g. for Messages), `url` is the actual file to share.
      text: shareTitle || filename,
      url: written.uri,
      dialogTitle: shareTitle || filename,
    });
    void result;
    return { ok: true, via: "native" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warn("native download failed:", msg);
    return { ok: false, error: msg };
  }
};

export const downloadFile = async (input: DownloadInput): Promise<DownloadResult> => {
  const { filename, mimeType, data, shareTitle } = input;
  if (!filename) return { ok: false, error: "filename is required" };
  if (!mimeType) return { ok: false, error: "mimeType is required" };
  if (data === undefined || data === null) return { ok: false, error: "data is required" };

  if (isNative()) {
    const result = await downloadOnNative(filename, mimeType, data, shareTitle || filename);
    if (result.ok) return result;
    // If native write/share failed (user cancelled the share sheet,
    // disk full, etc.), don't fall back to <a download> — WKWebView
    // ignores it anyway and we'd just confuse callers about success.
    return result;
  }

  return downloadOnWeb(filename, mimeType, data);
};

// Convenience wrappers — match the call shapes already in the repo so
// drop-in replacement at existing sites is one-liner.

export const downloadJson = (filename: string, value: unknown): Promise<DownloadResult> =>
  downloadFile({
    filename,
    mimeType: "application/json",
    data: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    shareTitle: filename,
  });

export const downloadCsv = (filename: string, csv: string): Promise<DownloadResult> =>
  downloadFile({
    filename,
    // BOM so Excel opens UTF-8 CSV correctly without prompting.
    mimeType: "text/csv;charset=utf-8",
    data: `﻿${csv}`,
    shareTitle: filename,
  });

export const downloadIcs = (filename: string, ics: string): Promise<DownloadResult> =>
  downloadFile({
    filename,
    mimeType: "text/calendar;charset=utf-8",
    data: ics,
    shareTitle: filename,
  });

export const downloadPdfBlob = (filename: string, blob: Blob): Promise<DownloadResult> =>
  downloadFile({
    filename,
    mimeType: blob.type || "application/pdf",
    data: blob,
    shareTitle: filename,
  });
