import { describe, it, expect } from "vitest";
import { fromCloudRow } from "./supabase";

// Regression test for the "quiet day" push false alarm: a stylist had a
// real, active appointment today, but the server-side notification sweep
// (which reads appointments through fromCloudRow) reported zero.
//
// Root cause: several server-side RPCs (cancel_appointment, the
// reschedule-approval flow, etc.) update the promoted `appt_date` /
// `appt_time` / `status` COLUMNS directly via SQL and never touch the
// `data` jsonb blob. fromCloudRow used to read the (possibly stale) jsonb
// value first and only fall back to the fresh column when the jsonb value
// was missing — the opposite of what its own comment promised ("overlay
// the promoted columns"). That let a stale jsonb `date`/`status` shadow a
// freshly-updated column, silently hiding a real appointment (or reviving
// a cancelled one) for any reader that goes through fromCloudRow.
describe("fromCloudRow", () => {
  it("prefers the fresh appt_date/appt_time/status columns over a stale data blob", () => {
    const row = {
      id: "appt_1",
      data: {
        // Stale values left behind by a write path that only touched the
        // promoted columns (e.g. a server-side RPC), not this jsonb blob.
        date: "2026-09-01",
        time: "14:00",
        status: "scheduled",
        clientName: "Wendy Barber",
      },
      appt_date: "2026-09-05",
      appt_time: "09:00",
      status: "scheduled",
      created_at: "2026-08-20T00:00:00.000Z",
      updated_at: "2026-09-04T00:00:00.000Z",
    };

    const appt = fromCloudRow("appointments", row);

    expect(appt.date).toBe("2026-09-05");
    expect(appt.time).toBe("09:00");
  });

  it("surfaces a column-only cancellation even when the jsonb blob still says scheduled", () => {
    const row = {
      id: "appt_2",
      data: { status: "scheduled", date: "2026-09-05" },
      status: "cancelled",
      appt_date: "2026-09-05",
    };

    const appt = fromCloudRow("appointments", row);

    expect(appt.status).toBe("cancelled");
  });

  it("falls back to the jsonb value when the column is null", () => {
    const row = {
      id: "appt_3",
      data: { date: "2026-09-05", time: "09:00" },
      appt_date: null,
      appt_time: null,
    };

    const appt = fromCloudRow("appointments", row);

    expect(appt.date).toBe("2026-09-05");
    expect(appt.time).toBe("09:00");
  });
});
