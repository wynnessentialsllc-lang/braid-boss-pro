"use client";

// Root error boundary. Catches errors thrown in the root layout itself —
// the one place a regular route-level error.tsx can't reach. Because it
// replaces the whole document, it must render its own <html>/<body>.

import RouteError from "./components/RouteError";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <RouteError
          error={error}
          reset={reset}
          title="The app hit a snag."
          message="Something went wrong while loading. Please try again — if it keeps happening, refresh the page."
        />
      </body>
    </html>
  );
}
