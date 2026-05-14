// Client-side admin guard.
//
// The real security boundary is the server: /api/admin/analytics
// rejects any caller whose JWT doesn't resolve to an admin email,
// AND analytics_summary_for_admin raises 'not_admin' if the email
// doesn't match the DB allow-list. This layout just redirects
// non-admin users to the app home so they never see admin chrome.
//
// We keep the check client-side because the app is a "use client"
// PWA with Supabase auth in localStorage; there's no SSR session
// cookie to read in a Server Component layout.

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "../lib/supabase";
import { isAdminUser } from "../lib/admin";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "admin" | "denied">("checking");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.auth.getSession();
        const email = data?.session?.user?.email ?? null;
        if (cancelled) return;
        if (isAdminUser(email)) {
          setState("admin");
        } else {
          setState("denied");
          router.replace("/");
        }
      } catch {
        if (!cancelled) {
          setState("denied");
          router.replace("/");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  if (state === "checking") {
    return (
      <div
        style={{
          minHeight: "100dvh",
          background: "#FFFFFF",
          color: "#2A1810",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          fontSize: 13,
          letterSpacing: "0.04em",
        }}
      >
        Checking admin access…
      </div>
    );
  }
  if (state === "denied") return null;
  return <>{children}</>;
}
