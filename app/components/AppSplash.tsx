"use client";

// The cold-start splash: brand mark on the app's own background, and
// nothing else.
//
// Shared by the two entry points that can land on the authenticated app
// (app/page.tsx and app/app/page.tsx) so they show the same thing while
// the AppRoot chunk downloads and the Supabase session is restored.
//
// Deliberately imports nothing from ../AppRoot — rendering the splash
// must never pull the heavy app chunk, which is the whole point of
// showing a splash in the first place.

import { Sparkles } from "lucide-react";
import { C } from "./marketing/tokens";

export default function AppSplash() {
  return (
    <div
      className="flex items-center justify-center"
      style={{ minHeight: "100dvh", background: C.paper }}
    >
      <div
        className="animate-pulse flex items-center justify-center"
        style={{ width: 56, height: 56, borderRadius: 999, background: C.brandPrimary }}
      >
        <Sparkles size={28} style={{ color: "#FFFFFF" }} />
      </div>
    </div>
  );
}
