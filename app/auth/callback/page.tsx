"use client";

// Landing page for Supabase auth redirects (email confirmation,
// password reset, magic link).
//
// The Supabase JS client is configured with `detectSessionInUrl: true`,
// which means it parses access_token / refresh_token from the URL hash
// automatically as soon as it's instantiated. Our job here is simply
// to (a) instantiate the client (via getSupabase() inside useEffect),
// (b) wait briefly for the session to settle, then (c) bounce the
// user into the app at "/".
//
// Keeping the redirect destination at /auth/callback (instead of "/")
// gives Supabase a stable URL to deep-link into — important for iOS
// Safari and the future Capacitor wrapper, where a custom universal
// link or deep link maps onto this exact path.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "../../lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const supabase = getSupabase();
        // detectSessionInUrl runs synchronously on construction, but
        // give the SDK a tick to finish writing the session to storage
        // before we navigate away.
        await supabase.auth.getSession();
        if (cancelled) return;
        router.replace("/");
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || "Sign-in link could not be processed.");
      }
    };
    run();
    return () => { cancelled = true; };
  }, [router]);

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#FAF5EC",
        color: "#2A1810",
        fontFamily: '"DM Sans", system-ui, sans-serif',
        padding: 24,
        textAlign: "center",
      }}>
      <div>
        <p style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: "#C9A961" }}>
          Braid Boss Pro
        </p>
        <p style={{ marginTop: 12, fontSize: 16 }}>
          {error ? error : "Signing you in…"}
        </p>
      </div>
    </main>
  );
}
