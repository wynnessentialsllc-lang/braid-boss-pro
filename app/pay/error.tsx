"use client";

import RouteError from "../components/RouteError";

export default function PayError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      title="Couldn't load this payment page."
      message="Something went wrong loading your payment details. No charge was made — please try again, or contact your stylist."
    />
  );
}
