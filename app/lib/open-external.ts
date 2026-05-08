import type React from "react";

// Native-aware external link opener.
//
// Web: regular window.open(url, "_blank") with noopener,noreferrer.
// Capacitor (iOS): SFSafariViewController via @capacitor/browser, so
// the user stays inside the app shell and can swipe-down back to BBP
// without losing state. Plain `target="_blank"` inside WKWebView opens
// the URL in the same webview and breaks our navigation history.
//
// Special schemes (mailto:, tel:, sms:, webcal:) bypass the in-app
// browser and route to the system handler in both web and native.

const isNative = (): boolean => {
  try {
    if (typeof window === "undefined") return false;
    const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
    return !!w.Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
};

const SPECIAL_SCHEME = /^(mailto:|tel:|sms:|webcal:)/i;

export type OpenExternalResult =
  | { ok: true; via: "web" | "native" | "scheme" }
  | { ok: false; error: string };

export const openExternal = async (url: string): Promise<OpenExternalResult> => {
  if (!url) return { ok: false, error: "url is required" };

  // Special schemes always go to the system handler. WKWebView routes
  // them to Mail / Phone / Messages / Calendar correctly via the
  // standard <a href> mechanism, so we just navigate.
  if (SPECIAL_SCHEME.test(url)) {
    try {
      if (typeof window !== "undefined") {
        window.location.href = url;
      }
      return { ok: true, via: "scheme" };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (isNative()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url });
      return { ok: true, via: "native" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn("[open-external] native open failed, falling back to web:", msg);
      }
      // Fall through to the web path so the link still works in the
      // unlikely event @capacitor/browser is missing at runtime.
    }
  }

  try {
    if (typeof window === "undefined") return { ok: false, error: "no window" };
    const w = window.open(url, "_blank", "noopener,noreferrer");
    if (!w) {
      // Popup blocker hit. Fall back to same-tab navigation so the
      // link is at least usable; the user can long-press in Safari
      // to escape the in-app webview if needed.
      window.location.href = url;
    }
    return { ok: true, via: "web" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

// Convenience for React onClick handlers — prevents the default
// navigation, then routes through the helper. Use this instead of
// onClick handlers that try to open URLs themselves.
export const handleExternalClick = (url: string) =>
  (e: React.MouseEvent<HTMLElement>): void => {
    e.preventDefault();
    void openExternal(url);
  };

// React-friendly: pass the URL via a data attribute and add this to a
// section's parent element if you'd rather not wire the helper into
// every individual <a>.
export const externalLinkProps = (url: string) => ({
  href: url,
  rel: "noopener noreferrer",
  target: "_blank" as const,
  onClick: (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (isNative() && !SPECIAL_SCHEME.test(url)) {
      e.preventDefault();
      void openExternal(url);
    }
  },
});
