"use client";

import RouteError from "../components/RouteError";

export default function ReviewError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      title="Couldn't load this review page."
      message="Something went wrong opening your review link. Please try again, or contact your stylist to resend it."
    />
  );
}
