"use client";

import RouteError from "../components/RouteError";

export default function BookError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      title="Couldn't load this booking page."
      message="Something went wrong opening this stylist's booking link. Please try again, or contact your stylist if it keeps happening."
    />
  );
}
