import { describe, test, expect } from "vitest";
import type { ProspectRow } from "@/lib/prospects/types";
import {
  BUCKET_HUE, TILE_ORDER, leadSit, leadLine, nextWhy, sourceMeta, filterLeads, nowCount, todayStats,
  canSaveOutcome, ageParts,
} from "../crm-model";

/** 2026-09-14 12:00 in Tripoli. */
const NOW = Date.parse("2026-09-14T10:00:00Z");
const ago = (m: number) => new Date(NOW - m * 60_000).toISOString();
const ahead = (m: number) => new Date(NOW + m * 60_000).toISOString();

function row(over: Partial<ProspectRow> = {}): ProspectRow {
  return {
    id: "l1", market_id: "m1", status: "assigned", source: "whatsapp", bucket: "hot",
    customer_name: "Amal Zentani", customer_phone: "0917788001", customer_city: "Tripoli", customer_address: null,
    product_id: null, product_name: null, product_price: null, product_image_url: null, product_note: null,
    notes: null, assigned_to: "a1", assigned_name: "Hend", callback_scheduled_at: null,
    converted_order_id: null, converted_order_ref: null,
    campaign_id: null, campaign_name: null, campaign_offer: null, campaign_script: null,
    source_order_id: null, source_order_ref: null, return_reason: null,
    repeat_kind: "none", prior_order_count: 0, prior_delivered_count: 0, prior_returned_count: 0,
    last_known_address: null, created_at: ago(23), updated_at: ago(23), last_touch_at: ago(23),
    ...over,
  };
}

describe("the seven tiles", () => {
  test("Tout first, then the six derived buckets in the prototype's order and hues", () => {
    expect(TILE_ORDER).toEqual(["all", "hot", "callback", "retry", "campaign", "winback", "converted"]);
    expect(BUCKET_HUE).toEqual({
      all: "neutral", hot: "pink", callback: "violet", retry: "amber", campaign: "blue", winback: "red", converted: "green",
    });
  });
});

describe("leadSit — the chip", () => {
  test("a reply on WhatsApp outranks the bucket", () => {
    expect(leadSit(row({ wa_replied_at: ago(5) }), NOW)).toMatchObject({ hue: "green", icon: "wa", key: "replied" });
  });
  test("hot says how long it has waited", () => {
    expect(leadSit(row(), NOW)).toMatchObject({ hue: "pink", icon: "spark", key: "hot", minutes: 23 });
  });
  test("an overdue callback turns red and counts its lateness; a future one is violet with its time", () => {
    expect(leadSit(row({ bucket: "callback", callback_scheduled_at: ago(65) }), NOW))
      .toMatchObject({ hue: "red", icon: "clock", key: "cbLate", minutes: 65 });
    expect(leadSit(row({ bucket: "callback", callback_scheduled_at: ahead(90) }), NOW))
      .toMatchObject({ hue: "violet", icon: "clock", key: "cbAt", at: ahead(90) });
  });
  test("retry counts the attempts", () => {
    expect(leadSit(row({ bucket: "retry", status: "attempt_2" }), NOW)).toMatchObject({ hue: "amber", icon: "phoneoff", key: "retry", n: 2 });
  });
  test("campaign, winback, converted", () => {
    expect(leadSit(row({ bucket: "campaign" }), NOW)).toMatchObject({ hue: "blue", icon: "mega", key: "campaign" });
    expect(leadSit(row({ bucket: "winback" }), NOW)).toMatchObject({ hue: "red", icon: "back", key: "winback" });
    expect(leadSit(row({ bucket: "converted", converted_order_ref: "48219" }), NOW)).toMatchObject({ hue: "green", icon: "check", key: "won", ref: "48219" });
    expect(leadSit(row({ bucket: "converted" }), NOW)).toMatchObject({ key: "wonNoRef" });
  });
});

describe("leadLine — the sentence under the chip", () => {
  test("hot quotes the customer's own words when there are some", () => {
    expect(leadLine(row({ notes: "بكم سعر؟" }), NOW)).toEqual({ quote: "بكم سعر؟" });
  });
  test("retry says when the last try was", () => {
    expect(leadLine(row({ bucket: "retry", status: "attempt_1", last_touch_at: ago(30) }), NOW)).toEqual({ key: "retry", minutes: 30 });
  });
  test("campaign names the campaign and when it was sent", () => {
    expect(leadLine(row({ bucket: "campaign", campaign_name: "Relance", wa_sent_at: ago(1440 + 60) }), NOW))
      .toEqual({ key: "campaign", name: "Relance", days: 1 });
    expect(leadLine(row({ bucket: "campaign", campaign_name: "Relance" }), NOW)).toEqual({ key: "campaign", name: "Relance", days: null });
  });
  test("winback carries the carrier's reason", () => {
    expect(leadLine(row({ bucket: "winback", return_reason: "Client absent" }), NOW)).toEqual({ key: "winback", why: "Client absent" });
    expect(leadLine(row({ bucket: "winback" }), NOW)).toEqual({ key: "winbackNoWhy" });
  });
});

describe("nextWhy — why this move, now", () => {
  test("callback late quotes the promised time; future says when", () => {
    expect(nextWhy(row({ bucket: "callback", callback_scheduled_at: ago(10) }), NOW)).toMatchObject({ key: "cbLate", at: ago(10) });
    expect(nextWhy(row({ bucket: "callback", callback_scheduled_at: ahead(10) }), NOW)).toMatchObject({ key: "cbAt", at: ahead(10) });
  });
  test("winback without a reason still reads", () => {
    expect(nextWhy(row({ bucket: "winback" }), NOW)).toMatchObject({ key: "winbackNoWhy" });
  });
});

describe("sourceMeta", () => {
  test("each source has a hue and an icon", () => {
    expect(sourceMeta("whatsapp")).toEqual({ hue: "green", icon: "wa" });
    expect(sourceMeta("facebook_dm")).toEqual({ hue: "blue", icon: "wa" });
    expect(sourceMeta("campaign")).toEqual({ hue: "blue", icon: "mega" });
    expect(sourceMeta("winback")).toEqual({ hue: "red", icon: "back" });
    expect(sourceMeta("manual_call")).toEqual({ hue: "neutral", icon: "user" });
  });
});

describe("filterLeads", () => {
  const rows = [
    row({ id: "a", bucket: "retry", customer_name: "Fatma", customer_phone: "0919982211", created_at: ago(100) }),
    row({ id: "b", bucket: "hot", customer_name: "Amal", product_name: "Sérum" }),
    row({ id: "c", bucket: "callback", customer_name: "Houda", callback_scheduled_at: ahead(30) }),
  ];
  test("sorts by bucket order", () => {
    expect(filterLeads(rows, "all", "", NOW).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
  test("filters by bucket, and by name, digits or product", () => {
    expect(filterLeads(rows, "retry", "", NOW).map((r) => r.id)).toEqual(["a"]);
    expect(filterLeads(rows, "all", "998 22", NOW).map((r) => r.id)).toEqual(["a"]);
    expect(filterLeads(rows, "all", "sér", NOW).map((r) => r.id)).toEqual(["b"]);
  });
});

describe("the header's numbers", () => {
  test("nowCount = hot + callbacks that are due", () => {
    const rows = [row(), row({ bucket: "callback", callback_scheduled_at: ago(1) }), row({ bucket: "callback", callback_scheduled_at: ahead(1) })];
    expect(nowCount(rows, NOW)).toBe(2);
  });
  test("todayStats counts the calls logged today and the conversions of today, on the market's clock", () => {
    const rows = [
      row({ status: "attempt_1", bucket: "retry", last_touch_at: ago(30) }),
      row({ status: "callback_scheduled", bucket: "callback", last_touch_at: ago(60) }),
      row({ status: "attempt_2", bucket: "retry", last_touch_at: ago(60 * 24 * 2) }),
      row({ status: "won", bucket: "converted", last_touch_at: ago(10) }),
      row({ status: "assigned", bucket: "hot", last_touch_at: ago(5) }),
    ];
    expect(todayStats(rows, NOW, null)).toEqual({ calls: 3, converted: 1 });
  });
});

describe("the outcome tray", () => {
  test("save waits for the second choice where one is needed", () => {
    expect(canSaveOutcome(null, null)).toBe(false);
    expect(canSaveOutcome("want", null)).toBe(true);
    expect(canSaveOutcome("na", null)).toBe(true);
    expect(canSaveOutcome("later", null)).toBe(false);
    expect(canSaveOutcome("later", "p1h")).toBe(true);
    expect(canSaveOutcome("no", "price")).toBe(true);
  });
});

describe("ageParts — the prototype's ageLong", () => {
  test("min, h mm, d [h]", () => {
    expect(ageParts(9)).toEqual({ key: "min", values: { n: 9 } });
    expect(ageParts(125)).toEqual({ key: "h", values: { h: 2, m: "05" } });
    expect(ageParts(1440 * 2)).toEqual({ key: "d", values: { d: 2 } });
    expect(ageParts(1440 + 180)).toEqual({ key: "dh", values: { d: 1, h: 3 } });
  });
});
