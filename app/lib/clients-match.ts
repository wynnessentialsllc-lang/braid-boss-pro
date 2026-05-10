// Client matching for booking-request approvals + waitlist
// conversions. Goal: never create a duplicate client when a
// returning person submits a public booking under the same email
// or phone.
//
// Match order (per spec):
//   1. Email — case-insensitive trim
//   2. Phone — strip every non-digit before comparing
//   3. If multiple candidates exist, return ambiguous + the list
//      so the UI can ask the stylist to pick
//   4. If none, returns no-match → caller creates a new client

export type ContactProbe = {
  email?: string | null;
  phone?: string | null;
};

export type ClientLike = {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type ClientMatch =
  | { kind: "none"; candidates: [] }
  | { kind: "single"; client: ClientLike; candidates: ClientLike[] }
  | { kind: "ambiguous"; candidates: ClientLike[] };

const normalizePhone = (raw: string | null | undefined): string => {
  if (!raw) return "";
  return String(raw).replace(/\D+/g, "");
};

const normalizeEmail = (raw: string | null | undefined): string => {
  if (!raw) return "";
  return String(raw).trim().toLowerCase();
};

export const matchClientByContact = (
  probe: ContactProbe,
  clients: ClientLike[] | null | undefined,
): ClientMatch => {
  const list = clients || [];
  const email = normalizeEmail(probe.email);
  const phone = normalizePhone(probe.phone);

  // Step 1: email match
  if (email) {
    const byEmail = list.filter(c => normalizeEmail(c.email) === email);
    if (byEmail.length === 1) return { kind: "single", client: byEmail[0], candidates: byEmail };
    if (byEmail.length > 1) return { kind: "ambiguous", candidates: byEmail };
  }

  // Step 2: phone match. Skip implausibly short normalized strings
  // so a stray "1" doesn't match every record.
  if (phone.length >= 7) {
    const byPhone = list.filter(c => {
      const cp = normalizePhone(c.phone);
      return cp.length >= 7 && cp === phone;
    });
    if (byPhone.length === 1) return { kind: "single", client: byPhone[0], candidates: byPhone };
    if (byPhone.length > 1) return { kind: "ambiguous", candidates: byPhone };
  }

  return { kind: "none", candidates: [] };
};

// Convenience: resolve a probe to a single client, with caller-supplied
// fallback for the ambiguous case (default = pick the first; the UI
// should call matchClientByContact() directly to surface a picker
// when match.kind === "ambiguous").
export const resolveClient = (
  probe: ContactProbe,
  clients: ClientLike[] | null | undefined,
  onAmbiguous: (candidates: ClientLike[]) => ClientLike | null = (cs) => cs[0] ?? null,
): ClientLike | null => {
  const m = matchClientByContact(probe, clients);
  if (m.kind === "single") return m.client;
  if (m.kind === "ambiguous") return onAmbiguous(m.candidates);
  return null;
};
