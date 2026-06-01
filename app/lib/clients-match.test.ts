import { describe, it, expect } from "vitest";
import {
  matchClientByContact,
  resolveClient,
  type ClientLike,
} from "./clients-match";

const ada: ClientLike = { id: "a", name: "Ada", email: "ada@example.com", phone: "(555) 123-4567" };
const bea: ClientLike = { id: "b", name: "Bea", email: "bea@example.com", phone: "555-987-6543" };
const adaDupe: ClientLike = { id: "c", name: "Ada (dupe)", email: "ADA@example.com", phone: null };

describe("matchClientByContact", () => {
  it("matches a single client by email, case-insensitively and trimmed", () => {
    const m = matchClientByContact({ email: "  ADA@Example.com " }, [ada, bea]);
    expect(m.kind).toBe("single");
    if (m.kind === "single") expect(m.client.id).toBe("a");
  });

  it("returns ambiguous when multiple clients share an email", () => {
    const m = matchClientByContact({ email: "ada@example.com" }, [ada, bea, adaDupe]);
    expect(m.kind).toBe("ambiguous");
    expect(m.candidates).toHaveLength(2);
  });

  it("matches by phone when email is absent, ignoring formatting", () => {
    const m = matchClientByContact({ phone: "5551234567" }, [ada, bea]);
    expect(m.kind).toBe("single");
    if (m.kind === "single") expect(m.client.id).toBe("a");
  });

  it("prefers an email match over a phone match", () => {
    // email points at Ada, phone points at Bea — email wins (step 1).
    const m = matchClientByContact(
      { email: "ada@example.com", phone: "5559876543" },
      [ada, bea],
    );
    expect(m.kind).toBe("single");
    if (m.kind === "single") expect(m.client.id).toBe("a");
  });

  it("ignores implausibly short phone probes", () => {
    const stub: ClientLike = { id: "x", phone: "1" };
    expect(matchClientByContact({ phone: "1" }, [stub]).kind).toBe("none");
  });

  it("returns none when nothing matches or the list is empty", () => {
    expect(matchClientByContact({ email: "nobody@example.com" }, [ada]).kind).toBe("none");
    expect(matchClientByContact({ email: "ada@example.com" }, null).kind).toBe("none");
  });
});

describe("resolveClient", () => {
  it("resolves a single match to that client", () => {
    expect(resolveClient({ email: "bea@example.com" }, [ada, bea])?.id).toBe("b");
  });

  it("returns null when there is no match", () => {
    expect(resolveClient({ email: "nobody@example.com" }, [ada])).toBeNull();
  });

  it("uses the ambiguous resolver, defaulting to the first candidate", () => {
    const clients = [ada, bea, adaDupe];
    expect(resolveClient({ email: "ada@example.com" }, clients)?.id).toBe("a");
    const picked = resolveClient(
      { email: "ada@example.com" },
      clients,
      (cs) => cs.find((c) => c.id === "c") ?? null,
    );
    expect(picked?.id).toBe("c");
  });
});
