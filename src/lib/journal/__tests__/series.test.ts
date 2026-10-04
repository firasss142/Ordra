import { describe, test, expect } from "vitest";
import { groupSeries } from "../series";
import type { FeedRow } from "../types";

const row = (over: Partial<FeedRow> & { at: string; id: string }): FeedRow => ({
  family: "team",
  kind: "order.status",
  severity: null,
  actor_id: "u1",
  actor_name: "tasnim",
  actor_role: "agent",
  market_id: "ly",
  order_id: null,
  order_ref: null,
  params: { to: "attempt_1" },
  ref: null,
  ...over,
});
const t = (hhmm: string, day = "2026-10-03") => `${day}T${hhmm}:00.000Z`;
const day = (iso: string) => iso.slice(0, 10);

describe("groupSeries", () => {
  test("the same person doing the same thing within 10 minutes is one line with a count", () => {
    const items = groupSeries(
      [
        row({ id: "a", at: t("14:43") }),
        row({ id: "b", at: t("14:40") }),
        row({ id: "c", at: t("14:35") }),
      ],
      day,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "a", at: t("14:43"), since: t("14:35"), count: 3 });
    expect(items[0].members.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  test("the window runs from the last merged row, so a steady pace stays one series", () => {
    const items = groupSeries(
      [row({ id: "a", at: t("15:00") }), row({ id: "b", at: t("14:52") }), row({ id: "c", at: t("14:44") })],
      day,
    );
    expect(items).toHaveLength(1);
    expect(items[0].count).toBe(3);
  });

  test("a gap longer than 10 minutes starts a new series", () => {
    const items = groupSeries([row({ id: "a", at: t("15:00") }), row({ id: "b", at: t("14:45") })], day);
    expect(items.map((i) => i.count)).toEqual([1, 1]);
  });

  test("another person's rows interleaved in between do not break a series", () => {
    const items = groupSeries(
      [
        row({ id: "a", at: t("15:00") }),
        row({ id: "x", at: t("14:59"), actor_id: "u2", actor_name: "salima" }),
        row({ id: "b", at: t("14:58") }),
      ],
      day,
    );
    expect(items.map((i) => [i.id, i.count])).toEqual([
      ["a", 2],
      ["x", 1],
    ]);
  });

  test("a different outcome is a different line (3ᵉ tentative ≠ confirmée)", () => {
    const items = groupSeries(
      [row({ id: "a", at: t("15:00"), params: { to: "confirmed" } }), row({ id: "b", at: t("14:59"), params: { to: "attempt_3" } })],
      day,
    );
    expect(items).toHaveLength(2);
  });

  test("carrier promotions group per carrier and per status", () => {
    const c = (id: string, at: string, carrier: string, to: string) =>
      row({ id, at, family: "ext", kind: "carrier.status", actor_id: null, params: { to, carrier } });
    const items = groupSeries(
      [c("a", t("16:23"), "Darb Tripoli", "delivered"), c("b", t("16:20"), "Darb Tripoli", "delivered"), c("d", t("16:19"), "Darb Benghazi", "delivered"), c("e", t("16:18"), "Darb Tripoli", "cancelled")],
      day,
    );
    expect(items.map((i) => [i.id, i.count])).toEqual([
      ["a", 2],
      ["d", 1],
      ["e", 1],
    ]);
  });

  test("a series never crosses midnight", () => {
    const items = groupSeries([row({ id: "a", at: t("00:02", "2026-10-03") }), row({ id: "b", at: t("23:58", "2026-10-02") })], day);
    expect(items).toHaveLength(2);
  });

  test("problems opening and closing are never merged", () => {
    const i = (id: string, at: string) => row({ id, at, family: "ext", kind: "issue.opened", severity: "fail", actor_id: null, params: { rule: "job_failing" } });
    expect(groupSeries([i("a", t("10:00")), i("b", t("09:59"))], day)).toHaveLength(2);
  });

  test("failures group like anything else, and keep their severity", () => {
    const f = (id: string, at: string) =>
      row({ id, at, family: "sec", kind: "app.error", severity: "fail", actor_id: null, params: { route: "/api/agents/[id]", method: "PATCH", status: 500 } });
    const items = groupSeries([f("a", t("15:12")), f("b", t("15:11"))], day);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ count: 2, severity: "fail" });
  });

  test("order is kept: each line sits at its newest member", () => {
    const items = groupSeries(
      [row({ id: "a", at: t("15:00") }), row({ id: "x", at: t("14:59"), kind: "delivery.call_customer" }), row({ id: "b", at: t("14:58") })],
      day,
    );
    expect(items.map((i) => i.id)).toEqual(["a", "x"]);
  });
});
