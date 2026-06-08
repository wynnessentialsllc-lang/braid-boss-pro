"use client";

import RouteError from "../components/RouteError";

export default function OrdersError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      title="Couldn't load this order."
      message="Something went wrong loading your order details. Please try again, or contact the stylist if it keeps happening."
    />
  );
}
