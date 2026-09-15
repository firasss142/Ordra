import { describe, expect, test } from "vitest";
import {
  BUCKET_TONE,
  situationOf,
  moveFor,
  moveTone,
  nextActionOf,
  formatPhone,
  historyOf,
  callbackChoices,
} from "../presentation";
import type { ProspectRow } from "../types";

const NOW = Date.parse("2026-09-14T10:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const minutesAhead = (m: number) => new Date(NOW + m * 60_000).toISOString();

function row(over: Partial<ProspectRow> = {}): ProspectRow {
  return {
    id: "l1", market_id: "m1", status: "assigned", source: "whatsapp", bucket: "hot",
    customer_name: "أمل الزنتاني", customer_phone: "0917788001", customer_city: "طرابلس", customer_address: null,
    product_id: null, product_name: null, product_price: null, product_image_url: null, product_note: null,
    notes: null, assigned_to: "a1", assigned_name: "Hend", callback_scheduled_at: null,
    converted_order_id: null, converted_order_ref: null,
    campaign_id: null, campaign_name: null, campaign_offer: null, campaign_script: null,
    source_order_id: null, source_order_ref: null, return_reason: null,
    repeat_kind: "none", prior_order_count: 0, prior_delivered_count: 0, prior_returned_count: 0,
    last_known_address: null,
    created_at: minutesAgo(6), updated_at: minutesAgo(6), last_touch_at: null,
    ...over,
  };
}

describe("BUCKET_TONE", () => {
  test("every bucket has a tone, and hot is the amber one the prototype pulses", () => {
    expect(BUCKET_TONE.hot).toBe("amber");
    expect(BUCKET_TONE.callback).toBe("blue");
    expect(BUCKET_TONE.retry).toBe("grey");
    expect(BUCKET_TONE.campaign).toBe("violet");
    expect(BUCKET_TONE.winback).toBe("red");
    expect(BUCKET_TONE.converted).toBe("green");
  });
});

describe("situationOf", () => {
  test("a hot prospect reads as its age in minutes, because the 10-minute rule is what the agent is racing", () => {
    const s = situationOf(row({ bucket: "hot", created_at: minutesAgo(23) }), NOW);
    expect(s).toMatchObject({ key: "hot", tone: "amber", minutes: 23 });
  });

  test("an overdue callback says how late it is, not when it was due", () => {
    const s = situationOf(row({ bucket: "callback", callback_scheduled_at: minutesAgo(25) }), NOW);
    expect(s).toMatchObject({ key: "callback_due", tone: "blue", minutes: 25 });
  });

  test("a callback still ahead shows the time it is set for", () => {
    const at = minutesAhead(95);
    const s = situationOf(row({ bucket: "callback", callback_scheduled_at: at }), NOW);
    expect(s).toMatchObject({ key: "callback_at", tone: "blue" });
    expect(s.at).toBe(at);
  });

  test("a retry names the attempt number so the agent knows how many tries are left", () => {
    const s = situationOf(row({ bucket: "retry", status: "attempt_2" }), NOW);
    expect(s).toMatchObject({ key: "retry", tone: "grey", attempts: 2 });
  });

  test("campaign stock reads as its campaign", () => {
    const s = situationOf(row({ bucket: "campaign", campaign_id: "c1" }), NOW);
    expect(s).toMatchObject({ key: "campaign", tone: "violet" });
  });

  test("a win-back carries the carrier's reason as free text, which is never translatable", () => {
    const s = situationOf(row({ bucket: "winback", return_reason: "الزبون لم يرد على الهاتف" }), NOW);
    expect(s.key).toBe("winback");
    expect(s.sub).toEqual({ text: "الزبون لم يرد على الهاتف" });
  });

  test("a win-back with no reason falls back to a translated line rather than showing an empty quote", () => {
    const s = situationOf(row({ bucket: "winback", return_reason: null }), NOW);
    expect(s.sub).toEqual({ key: "winback" });
  });

  test("a converted prospect shows its order reference", () => {
    const s = situationOf(row({ bucket: "converted", converted_order_ref: "48219" }), NOW);
    expect(s).toMatchObject({ key: "converted", tone: "green", orderRef: "48219" });
  });
});

describe("moveFor", () => {
  test("a hot prospect is a call to the number they wrote from", () => {
    expect(moveFor(row({ bucket: "hot" }), NOW)).toMatchObject({ kind: "call", dial: "0917788001" });
  });

  test("a win-back offers the re-send rather than a cold call", () => {
    expect(moveFor(row({ bucket: "winback" }), NOW).kind).toBe("resend");
  });

  test("a campaign lead is called with the script", () => {
    expect(moveFor(row({ bucket: "campaign", campaign_id: "c1" }), NOW).kind).toBe("script");
  });

  test("a converted prospect has nothing left to do but open the order", () => {
    const m = moveFor(row({ bucket: "converted", converted_order_id: "o1" }), NOW);
    expect(m).toMatchObject({ kind: "order", dial: null });
  });

  test("a retry still dials, so the agent never has to leave the row to try again", () => {
    expect(moveFor(row({ bucket: "retry", status: "attempt_1" }), NOW).dial).toBe("0917788001");
  });
});

describe("moveTone", () => {
  test("the action button borrows the row's tone so the list reads as one system", () => {
    expect(moveTone(row({ bucket: "hot" }), NOW)).toBe("amber");
    expect(moveTone(row({ bucket: "winback" }), NOW)).toBe("red");
  });
});

describe("nextActionOf", () => {
  test("the panel's headline says what to do and why, keyed for translation", () => {
    const n = nextActionOf(row({ bucket: "hot", created_at: minutesAgo(12) }), NOW);
    expect(n.titleKey).toBe("next.hot.title");
    expect(n.whyKey).toBe("next.hot.why");
    expect(n.whyValues).toMatchObject({ minutes: 12 });
  });

  test("a campaign prospect's reason carries the offer, which is the only thing the agent can promise", () => {
    const n = nextActionOf(row({ bucket: "campaign", campaign_offer: "−15 % sur le 50 ml" }), NOW);
    expect(n.whyValues).toMatchObject({ offer: "−15 % sur le 50 ml" });
  });
});

describe("formatPhone", () => {
  test("groups a Libyan number the way the prototype prints it", () => {
    expect(formatPhone("0921122334")).toBe("092 112 2334");
  });

  test("leaves a number it does not recognise exactly as it was stored", () => {
    expect(formatPhone("+216 55 123 456")).toBe("+216 55 123 456");
  });

  test("an empty number is empty, not the string null", () => {
    expect(formatPhone(null)).toBe("");
  });
});

describe("historyOf", () => {
  test("a phone with no past is a new customer", () => {
    expect(historyOf(row())).toMatchObject({ key: "new", tone: "grey" });
  });

  test("deliveries with no returns read as a loyal customer", () => {
    const h = historyOf(row({ repeat_kind: "repeat", prior_order_count: 3, prior_delivered_count: 3 }));
    expect(h).toMatchObject({ key: "loyal", tone: "green", delivered: 3 });
  });

  // The DB's customer_risk_class counts returned + rejected; classify.ts counts
  // rejected only. Here the badge follows what the agent can see: returns.
  test("returns and no deliveries is the risk the agent must see before promising anything", () => {
    const h = historyOf(row({ repeat_kind: "risk", prior_order_count: 2, prior_delivered_count: 0, prior_returned_count: 2 }));
    expect(h).toMatchObject({ key: "risk", tone: "red", returned: 2 });
  });

  test("a mixed record shows both figures rather than picking a side", () => {
    const h = historyOf(row({ repeat_kind: "repeat", prior_order_count: 5, prior_delivered_count: 4, prior_returned_count: 1 }));
    expect(h).toMatchObject({ key: "mixed", delivered: 4, returned: 1 });
  });
});

describe("callbackChoices", () => {
  test("offers the prototype's four times, on the market clock", () => {
    const choices = callbackChoices(NOW, "Africa/Tripoli");
    expect(choices.map((c) => c.key)).toEqual(["p1h", "p2h", "evening", "tomorrow"]);
    expect(Date.parse(choices[0].at) - NOW).toBe(3_600_000);
    expect(Date.parse(choices[1].at) - NOW).toBe(7_200_000);
  });

  test("tomorrow is 10:00 on the market clock, not on the browser's", () => {
    // 10:00 Africa/Tripoli (UTC+2) is 08:00 UTC.
    const tomorrow = callbackChoices(NOW, "Africa/Tripoli").find((c) => c.key === "tomorrow")!;
    expect(new Date(tomorrow.at).toISOString()).toBe("2026-09-15T08:00:00.000Z");
  });

  test("an evening callback that has already passed is dropped rather than offered in the past", () => {
    const lateNight = Date.parse("2026-09-14T19:00:00Z"); // 21:00 Tripoli
    expect(callbackChoices(lateNight, "Africa/Tripoli").map((c) => c.key)).not.toContain("evening");
  });
});
