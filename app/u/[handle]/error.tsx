"use client";

import RouteError from "../../components/RouteError";

export default function StorefrontError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      title="Couldn't load this storefront."
      message="Something went wrong loading this shop. Please try again in a moment."
    />
  );
}
