import { describe, it, expect } from "vitest";
import {
  encodeTargetUrl,
  decodeTargetUrl,
  type PushTarget,
} from "./notification-target-url";

const ORIGIN = "https://braidbosspro.app";
const decode = (url: string) => decodeTargetUrl(url, ORIGIN);

describe("encodeTargetUrl", () => {
  it("encodes a record-scoped target with its id", () => {
    expect(encodeTargetUrl({ kind: "appointment", appointmentId: "appt_1" }))
      .toBe("/?n=appointment&id=appt_1");
  });

  it("encodes a standalone screen target with no id", () => {
    expect(encodeTargetUrl({ kind: "waitlist" })).toBe("/?n=waitlist");
  });

  it("carries the rebooking sub-action for retention pushes", () => {
    expect(encodeTargetUrl({ kind: "client", clientId: "c1", action: "rebooking" }))
      .toBe("/?n=client&id=c1&a=rebooking");
  });

  it("omits the sub-action for a plain client target", () => {
    expect(encodeTargetUrl({ kind: "client", clientId: "c1" }))
      .toBe("/?n=client&id=c1");
  });

  it("falls back to / when a record-scoped target has no id", () => {
    // Better to open the app than to ship a link that resolves to nothing.
    expect(encodeTargetUrl({ kind: "appointment", appointmentId: "" })).toBe("/");
  });

  it("falls back to / for a missing target", () => {
    expect(encodeTargetUrl(null)).toBe("/");
    expect(encodeTargetUrl(undefined)).toBe("/");
  });

  it("percent-encodes ids so they survive the round trip", () => {
    const target: PushTarget = { kind: "client", clientId: "a b&c=d" };
    expect(decode(encodeTargetUrl(target))).toEqual(target);
  });
});

describe("decodeTargetUrl — canonical", () => {
  it("round-trips every target kind", () => {
    const targets: PushTarget[] = [
      { kind: "appointment", appointmentId: "appt_1" },
      { kind: "client", clientId: "c1" },
      { kind: "client", clientId: "c1", action: "rebooking" },
      { kind: "booking_approval", requestId: "req_1" },
      { kind: "email_log", queueId: "q_1" },
      { kind: "contract_view", contractId: "ct_1" },
      { kind: "reminders" },
      { kind: "schedule" },
      { kind: "clientsTab" },
      { kind: "reviews" },
      { kind: "inbox" },
      { kind: "packages" },
      { kind: "styleRequests" },
      { kind: "waitlist" },
    ];
    for (const target of targets) {
      expect(decode(encodeTargetUrl(target))).toEqual(target);
    }
  });

  it("accepts an absolute URL", () => {
    expect(decode(`${ORIGIN}/?n=inbox`)).toEqual({ kind: "inbox" });
  });

  it("rejects a record-scoped kind with no id", () => {
    expect(decode("/?n=appointment")).toBeNull();
  });

  it("rejects an unknown kind", () => {
    expect(decode("/?n=not_a_real_screen")).toBeNull();
  });
});

describe("decodeTargetUrl — legacy shapes", () => {
  // Pushes already delivered to a device keep their original URL, so a
  // tap on a week-old notification has to keep routing correctly.

  it("maps ?focus=appointment (the shape that was silently dropped)", () => {
    expect(decode("/?focus=appointment&id=appt_9"))
      .toEqual({ kind: "appointment", appointmentId: "appt_9" });
  });

  it("maps ?focus=client", () => {
    expect(decode("/?focus=client&id=c9")).toEqual({ kind: "client", clientId: "c9" });
  });

  it("maps ?focus=client&action=rebooking to the pause sheet", () => {
    expect(decode("/?focus=client&id=c9&action=rebooking"))
      .toEqual({ kind: "client", clientId: "c9", action: "rebooking" });
  });

  it("maps ?focus=inbox", () => {
    expect(decode("/?focus=inbox")).toEqual({ kind: "inbox" });
  });

  it("maps the ?tab= shapes", () => {
    expect(decode("/?tab=schedule")).toEqual({ kind: "schedule" });
    expect(decode("/?tab=clients")).toEqual({ kind: "clientsTab" });
  });

  it("maps ?notification=reviews sent by internal_send_push", () => {
    expect(decode("/?notification=reviews")).toEqual({ kind: "reviews" });
  });

  it("rejects a legacy focus with no id", () => {
    expect(decode("/?focus=client")).toBeNull();
    expect(decode("/?focus=appointment")).toBeNull();
  });
});

describe("decodeTargetUrl — no target", () => {
  it("returns null for the bare root URL", () => {
    // The old default. Callers treat null as "open the app, don't navigate".
    expect(decode("/")).toBeNull();
  });

  it("returns null for empty or malformed input", () => {
    expect(decodeTargetUrl("", ORIGIN)).toBeNull();
    expect(decodeTargetUrl(null, ORIGIN)).toBeNull();
    expect(decodeTargetUrl(undefined, ORIGIN)).toBeNull();
  });

  it("prefers the canonical param when both are present", () => {
    expect(decode("/?n=waitlist&focus=client&id=c1")).toEqual({ kind: "waitlist" });
  });
});
