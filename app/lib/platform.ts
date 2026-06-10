"use client";

// Centralized native-shell (Capacitor) detection — shared by the
// in-person payment UI, subscription/App-Store compliance gating, and
// anything that must render differently inside the iOS/Android app vs
// the web/PWA. Mirrors the runtime guard in native-download.ts but adds
// an SSR-safe React hook so the server render and first client render
// agree ("web") before hydrating to the real value, avoiding a flash.

import { useEffect, useState } from "react";

// Synchronous check — reads the global Capacitor injects at runtime so
// we never import @capacitor/core into the web bundle. Returns false on
// the server and on plain web/PWA; true only inside the native shell.
export const isNativePlatform = (): boolean => {
  try {
    if (typeof window === "undefined") return false;
    const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
    return !!w.Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
};

// SSR-safe hook. Always returns false for the server + first paint, then
// updates after mount. Use this to gate UI (e.g. hide in-app purchase
// CTAs on iOS) without a hydration mismatch.
export const useIsNativePlatform = (): boolean => {
  const [native, setNative] = useState(false);
  useEffect(() => {
    setNative(isNativePlatform());
  }, []);
  return native;
};
