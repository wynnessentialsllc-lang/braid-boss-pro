"use client";

import { useEffect } from "react";

// Read Capacitor off the global the iOS shell injects at runtime.
// `import { Capacitor } from "@capacitor/core"` left methods as
// undefined in the static-export bundle and threw `i is not a
// function` during initial mount, which crashed WKWebView before
// any UI rendered. Optional-chain every access so nothing here can
// ever throw.
export default function CapacitorSafeArea() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    try {
      const cap = (window as any).Capacitor;
      const isNative = typeof cap?.isNativePlatform === "function" && cap.isNativePlatform();
      const platform = typeof cap?.getPlatform === "function" ? cap.getPlatform() : "";
      if (isNative && platform === "ios") {
        document.documentElement.classList.add("capacitor-ios");
      }
    } catch {
      // Never let this helper crash the app.
    }
  }, []);
  return null;
}
