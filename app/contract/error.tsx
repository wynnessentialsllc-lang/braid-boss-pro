"use client";

import RouteError from "../components/RouteError";

export default function ContractError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      {...props}
      title="Couldn't load this agreement."
      message="Something went wrong opening your contract. Please try again, or contact your stylist to resend the link."
    />
  );
}
