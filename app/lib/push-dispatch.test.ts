import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NotificationRule } from "./notification-rules";

// Controllable mock of the appointments status lookup. Each test sets
// `mockResult` to whatever `.in("id", ids)` should resolve to.
let mockResult: { data: any[] | null; error: any };
vi.mock("./supabase", () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        in: () => Promise.resolve(mockResult),
      }),
    }),
  }),
}));

import { dropInactiveAppointmentRules } from "./push-dispatch";

const apptRule = (id: string, appointmentId: string): NotificationRule => ({
  id,
  kind: "appt_2h",
  category: "appointment",
  priority: "high",
  title: "Client starts soon",
  body: "the appointment soon",
  appointmentId,
});

const retentionRule = (id: string): NotificationRule => ({
  id,
  kind: "retention_at_risk",
  category: "retention",
  priority: "medium",
  title: "Client hasn't returned",
  body: "...",
  clientId: "c1",
});

describe("dropInactiveAppointmentRules", () => {
  beforeEach(() => {
    mockResult = { data: [], error: null };
  });

  it("keeps reminders for appointments still active in the DB", async () => {
    mockResult = { data: [{ id: "a1", status: "confirmed" }], error: null };
    const rules = [apptRule("appt_2h:a1", "a1")];
    expect(await dropInactiveAppointmentRules(rules)).toHaveLength(1);
  });

  it("drops reminders for appointments cancelled off-device", async () => {
    mockResult = { data: [{ id: "a1", status: "cancelled" }], error: null };
    const rules = [apptRule("appt_2h:a1", "a1")];
    expect(await dropInactiveAppointmentRules(rules)).toHaveLength(0);
  });

  it("treats every inactive status (both spellings, no-show variants) as suppressed", async () => {
    const inactive = ["canceled", "cancelled", "completed", "no_show", "no-show", "noshow", "declined", "CANCELLED"];
    for (const status of inactive) {
      mockResult = { data: [{ id: "a1", status }], error: null };
      const out = await dropInactiveAppointmentRules([apptRule("appt_2h:a1", "a1")]);
      expect(out, `status=${status}`).toHaveLength(0);
    }
  });

  it("drops reminders whose appointment row was deleted", async () => {
    mockResult = { data: [], error: null }; // id not returned
    const rules = [apptRule("appt_2h:gone", "gone")];
    expect(await dropInactiveAppointmentRules(rules)).toHaveLength(0);
  });

  it("never touches non-appointment rules", async () => {
    mockResult = { data: [], error: null };
    const rules = [retentionRule("retention:c1")];
    expect(await dropInactiveAppointmentRules(rules)).toHaveLength(1);
  });

  it("fails open (keeps all) on a query error so a blip can't silence reminders", async () => {
    mockResult = { data: null, error: { message: "network" } };
    const rules = [apptRule("appt_2h:a1", "a1"), retentionRule("retention:c1")];
    expect(await dropInactiveAppointmentRules(rules)).toHaveLength(2);
  });

  it("short-circuits with no DB call when there are no appointment rules", async () => {
    const rules = [retentionRule("retention:c1")];
    expect(await dropInactiveAppointmentRules(rules)).toEqual(rules);
  });

  it("filters a mixed batch, keeping active + non-appointment and dropping cancelled", async () => {
    mockResult = {
      data: [
        { id: "a1", status: "confirmed" },
        { id: "a2", status: "cancelled" },
      ],
      error: null,
    };
    const rules = [
      apptRule("appt_2h:a1", "a1"),
      apptRule("appt_2h:a2", "a2"),
      retentionRule("retention:c1"),
    ];
    const out = await dropInactiveAppointmentRules(rules);
    expect(out.map((r) => r.id)).toEqual(["appt_2h:a1", "retention:c1"]);
  });
});
