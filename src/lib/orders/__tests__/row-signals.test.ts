import { describe, it, expect } from "vitest";
import { ageTone, reliabilityChip, rowTags } from "@/lib/orders/row-signals";

const NOW = new Date("2026-10-04T15:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

describe("ageTone — coloured only while a human owes the order something", () => {
  it("is quiet before the SLA, amber past it, red past a day", () => {
    expect(ageTone({ status: "pending", created_at: ago(30) }, 120, NOW)).toBe("");
    expect(ageTone({ status: "attempt_2", created_at: ago(200) }, 120, NOW)).toBe("late");
    expect(ageTone({ status: "confirmed", created_at: ago(2000) }, 120, NOW)).toBe("vlate");
  });

  it("a callback is owed only once its time has passed", () => {
    expect(ageTone({ status: "callback_scheduled", created_at: ago(300), callback_scheduled_at: ago(-60) }, 120, NOW)).toBe("");
    expect(ageTone({ status: "callback_scheduled", created_at: ago(300), callback_scheduled_at: ago(10) }, 120, NOW)).toBe("late");
  });

  it("an order on the road or finished is never late here", () => {
    expect(ageTone({ status: "in_transit", created_at: ago(5000) }, 120, NOW)).toBe("");
    expect(ageTone({ status: "rejected", created_at: ago(5000) }, 120, NOW)).toBe("");
  });

  it("says nothing until the market's SLA is known", () => {
    expect(ageTone({ status: "pending", created_at: ago(500) }, null, NOW)).toBe("");
  });
});

describe("rowTags — at most two, in words, with the number that decides", () => {
  it("a duplicate whose copy is already shipped is red", () => {
    const tags = rowTags({ status: "pending", is_potential_duplicate: true, duplicate_count: 1, has_uploaded_sibling: true });
    expect(tags[0]).toMatchObject({ kind: "dup", hue: "red", n: 2, shipped: true });
  });

  it("a plain duplicate is blue", () => {
    expect(rowTags({ status: "pending", is_potential_duplicate: true, duplicate_count: 2 })[0]).toMatchObject({ kind: "dup", hue: "blue", n: 3, shipped: false });
  });

  it("a shipped order is not « déjà envoyé » against itself", () => {
    expect(rowTags({ status: "uploaded", is_potential_duplicate: true, duplicate_count: 1, has_uploaded_sibling: true })[0]).toMatchObject({ hue: "blue" });
  });

  it("a past rejection wins over loyalty", () => {
    const tags = rowTags({ status: "pending", prior_order_count: 4, prior_rejected_count: 2, prior_delivered_count: 2 });
    expect(tags).toEqual([{ kind: "rejected", hue: "red", n: 2, of: 4 }]);
  });

  it("delivered and never rejected is « Client fidèle »", () => {
    expect(rowTags({ status: "pending", prior_order_count: 3, prior_delivered_count: 3 })).toEqual([{ kind: "loyal", hue: "green", n: 3, of: 3 }]);
  });

  it("a deleted order carries no duplicate tag", () => {
    expect(rowTags({ status: "deleted", is_potential_duplicate: true, duplicate_count: 1 })).toEqual([]);
  });
});

describe("reliabilityChip — the panel's word for the customer", () => {
  it("anything lost is « À risque », with the count", () => {
    expect(reliabilityChip({ prior_order_count: 5, prior_rejected_count: 1, prior_returned_count: 1, prior_delivered_count: 3 })).toEqual({ kind: "risk", lost: 2, of: 5 });
  });
  it("delivered and nothing lost is « Fiable »", () => {
    expect(reliabilityChip({ prior_order_count: 2, prior_delivered_count: 2 })).toEqual({ kind: "ok", delivered: 2 });
  });
  it("no past is « Nouveau client »", () => {
    expect(reliabilityChip({})).toEqual({ kind: "new" });
  });
});
