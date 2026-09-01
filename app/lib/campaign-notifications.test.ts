import { describe, it, expect } from "vitest";
import {
  campaignGroupKey,
  groupCampaignRows,
  summarizeRecipients,
  type CampaignRecipientRef,
} from "./campaign-notifications";

type Row = { id: string; campaign?: CampaignRecipientRef };

const recipient = (
  key: string,
  name: string,
  over: Partial<CampaignRecipientRef> = {},
): CampaignRecipientRef => ({
  key,
  name,
  email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
  queueId: `q-${name}`,
  subject: "Spring braid drop",
  ...over,
});

const row = (id: string, campaign?: CampaignRecipientRef): Row => ({ id, campaign });

describe("campaignGroupKey", () => {
  it("uses the campaign id when the mirror trigger stamped one", () => {
    expect(campaignGroupKey("camp-1", "Spring drop", "2026-09-01T12:00:00Z")).toBe("camp-1");
  });

  it("falls back to subject + send day for rows mirrored before that", () => {
    expect(campaignGroupKey(null, "Spring drop", "2026-09-01T12:00:00Z"))
      .toBe("subject:Spring drop|2026-09-01");
  });

  it("keeps two same-subject sends on different days apart", () => {
    const a = campaignGroupKey("", "Spring drop", "2026-09-01T12:00:00Z");
    const b = campaignGroupKey("", "Spring drop", "2026-09-08T12:00:00Z");
    expect(a).not.toBe(b);
  });

  it("treats blank/whitespace ids as missing", () => {
    expect(campaignGroupKey("   ", "Spring drop", "2026-09-01T12:00:00Z"))
      .toBe("subject:Spring drop|2026-09-01");
  });
});

describe("summarizeRecipients", () => {
  it("names up to three recipients", () => {
    expect(summarizeRecipients(["Jessica Shepherd", "Bailey Cooper", "Penny Bygrave"]))
      .toBe("To Jessica Shepherd, Bailey Cooper, Penny Bygrave");
  });

  it("counts the rest beyond the first three", () => {
    const names = ["Jessica Shepherd", "Bailey Cooper", "Penny Bygrave", "Chanda Picott", "Lysha Gopaul"];
    expect(summarizeRecipients(names))
      .toBe("To Jessica Shepherd, Bailey Cooper, Penny Bygrave +2 more");
  });

  it("ignores blanks and returns nothing when there are no names", () => {
    expect(summarizeRecipients(["Jessica Shepherd", "", "   "])).toBe("To Jessica Shepherd");
    expect(summarizeRecipients([])).toBe("");
  });
});

describe("groupCampaignRows", () => {
  it("collapses a send into one group holding every recipient", () => {
    const rows = [
      row("n1", recipient("camp-1", "Jessica Shepherd")),
      row("n2", recipient("camp-1", "Bailey Cooper")),
      row("n3", recipient("camp-1", "Penny Bygrave")),
    ];
    const out = groupCampaignRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("group");
    if (out[0].kind !== "group") throw new Error("expected a group");
    expect(out[0].key).toBe("camp-1");
    expect(out[0].members.map(m => m.id)).toEqual(["n1", "n2", "n3"]);
  });

  it("leaves a one-recipient campaign as its own row", () => {
    const out = groupCampaignRows([row("n1", recipient("camp-1", "Jessica Shepherd"))]);
    expect(out).toEqual([{ kind: "single", item: { id: "n1", campaign: expect.anything() } }]);
  });

  it("never touches rows that aren't campaign sends", () => {
    const rows = [row("appt-1"), row("email-1")];
    expect(groupCampaignRows(rows).map(e => e.kind)).toEqual(["single", "single"]);
  });

  it("keeps two campaigns separate and holds the newest-first order", () => {
    const rows = [
      row("a1", recipient("camp-a", "Jessica Shepherd")),
      row("b1", recipient("camp-b", "Chanda Picott")),
      row("a2", recipient("camp-a", "Bailey Cooper")),
      row("b2", recipient("camp-b", "Lysha Gopaul")),
    ];
    const out = groupCampaignRows(rows);
    expect(out).toHaveLength(2);
    // Each group sits where its newest row was, so the bell stays in
    // reverse-chronological order.
    expect(out.map(e => (e.kind === "group" ? e.key : "?"))).toEqual(["camp-a", "camp-b"]);
  });

  it("keeps non-campaign rows interleaved in place", () => {
    const rows = [
      row("appt-1"),
      row("c1", recipient("camp-1", "Jessica Shepherd")),
      row("c2", recipient("camp-1", "Bailey Cooper")),
      row("appt-2"),
    ];
    const out = groupCampaignRows(rows);
    expect(out.map(e => (e.kind === "group" ? `group:${e.key}` : e.item.id)))
      .toEqual(["appt-1", "group:camp-1", "appt-2"]);
  });
});
