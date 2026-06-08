"use client";

// App-wide segment error boundary. Catches unexpected throws anywhere
// under app/ that a more specific route error.tsx didn't handle, so a
// single render error degrades to a friendly retry card instead of a
// blank screen.

import RouteError from "./components/RouteError";

export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} />;
}
