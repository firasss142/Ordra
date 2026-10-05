import { describe, it, expect } from "vitest";
import { activityOf, bucketOfStatus, closedKeyOf, isCallbackDue, tileHint, queueRank } from "@/components/agent/queue/model";

const NOW = new Date("2026-10-04T17:20:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60000).toISOString();
const later = (min: number) => new Date(NOW.getTime() + min * 60000).toISOString();

describe("the four buckets (prototype bucketOf)", () => {
  it("puts pending in Nouveau, attempts / callbacks / scheduled sends in En cours, confirmed in Confirmé", () => {
    expect(bucketOfStatus("pending")).toBe("new");
    expect(bucketOfStatus("assigned")).toBe("new");
    expect(bucketOfStatus("attempt_2")).toBe("cours");
    expect(bucketOfStatus("callback_scheduled")).toBe("cours");
    expect(bucketOfStatus("dispatch_scheduled")).toBe("cours");
    expect(bucketOfStatus("confirmed")).toBe("conf");
    expect(bucketOfStatus("uploaded")).toBeNull();
  });

  it("names the carrier's « deposit » bucket « Chez le transporteur » (it said « En cours » inside Fermées)", () => {
    expect(closedKeyOf("deposit")).toBe("carrier");
    expect(closedKeyOf("uploaded")).toBe("uploaded");
    expect(closedKeyOf("rejected")).toBe("rejected");
  });
});

describe("a callback is due once its time has passed", () => {
  it("is due when the time is past, not before", () => {
    expect(isCallbackDue({ status: "callback_scheduled", callback_time: ago(47) }, NOW)).toBe(true);
    expect(isCallbackDue({ status: "callback_scheduled", callback_time: later(12) }, NOW)).toBe(false);
    expect(isCallbackDue({ status: "attempt_1", callback_time: ago(47) }, NOW)).toBe(false);
  });

  it("ranks a due callback first, then attempts, then new, then the rest (lib/orders/queue-sort)", () => {
    expect(queueRank({ status: "callback_scheduled", callback_time: ago(5) }, NOW)).toBe(0);
    expect(queueRank({ status: "attempt_1", callback_time: null }, NOW)).toBe(1);
    expect(queueRank({ status: "pending", callback_time: null }, NOW)).toBe(2);
    expect(queueRank({ status: "callback_scheduled", callback_time: later(30) }, NOW)).toBe(3);
  });
});

describe("what was done, in words (prototype activity)", () => {
  it("a new order was never called", () => {
    expect(activityOf({ status: "pending", attempt_count: 0, last_action_at: null, callback_time: null, scheduled_dispatch_at: null }, NOW)).toEqual({ kind: "new" });
  });

  it("an attempt says n/max and when the last call was; red after a day without a call", () => {
    const a = activityOf({ status: "attempt_2", attempt_count: 2, last_action_at: ago(90), callback_time: null, scheduled_dispatch_at: null }, NOW);
    expect(a).toEqual({ kind: "attempt", n: 2, since: ago(90), stale: false });
    const b = activityOf({ status: "attempt_1", attempt_count: 1, last_action_at: ago(1500), callback_time: null, scheduled_dispatch_at: null }, NOW);
    expect(b).toMatchObject({ kind: "attempt", stale: true });
  });

  it("a callback writes its time on the row — « Rappel dû » once past (the row never said it)", () => {
    expect(activityOf({ status: "callback_scheduled", attempt_count: 1, last_action_at: ago(200), callback_time: ago(47), scheduled_dispatch_at: null }, NOW)).toEqual({
      kind: "callback",
      at: ago(47),
      due: true,
      n: 1,
    });
  });

  it("a confirmed order is not yet sent; a scheduled one says when it leaves", () => {
    expect(activityOf({ status: "confirmed", attempt_count: 1, last_action_at: ago(8), callback_time: null, scheduled_dispatch_at: null }, NOW)).toEqual({ kind: "confirmed", since: ago(8) });
    expect(activityOf({ status: "dispatch_scheduled", attempt_count: 1, last_action_at: ago(8), callback_time: null, scheduled_dispatch_at: later(600) }, NOW)).toEqual({ kind: "scheduled", at: later(600) });
  });
});

describe("the tiles' small line", () => {
  it("Nouveau tells the oldest wait; En cours turns into the late callbacks when there are some", () => {
    expect(tileHint("new", { new: 3, oldestNewMin: 135, late: 0, tent: 0, rappel: 0, conf: 0 })).toEqual({ key: "newOldest", min: 135 });
    expect(tileHint("new", { new: 0, oldestNewMin: 0, late: 0, tent: 0, rappel: 0, conf: 0 })).toEqual({ key: "newNone" });
    expect(tileHint("cours", { new: 0, oldestNewMin: 0, late: 2, tent: 4, rappel: 3, conf: 0 })).toEqual({ key: "coursLate", n: 2, alarm: true });
    expect(tileHint("cours", { new: 0, oldestNewMin: 0, late: 0, tent: 4, rappel: 3, conf: 0 })).toEqual({ key: "coursSplit", tent: 4, rappel: 3 });
    expect(tileHint("conf", { new: 0, oldestNewMin: 0, late: 0, tent: 0, rappel: 0, conf: 2 })).toEqual({ key: "confToSend" });
    expect(tileHint("conf", { new: 0, oldestNewMin: 0, late: 0, tent: 0, rappel: 0, conf: 0 })).toEqual({ key: "confNone" });
    expect(tileHint("closed", { new: 0, oldestNewMin: 0, late: 0, tent: 0, rappel: 0, conf: 0 })).toEqual({ key: "closed" });
  });
});
