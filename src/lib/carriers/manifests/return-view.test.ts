import { describe, it, expect } from "vitest";
import { summarizeReturnManifests, type ReturnManifestRow } from "./return-view";

/**
 * The « Retours » home (prototypes/xdelivery-manifests-v1.html, screen 1): each list
 * with its progress, and three totals — to receive, missing, set aside.
 * A line is missing only once its list is CLOSED; before that it is just not here yet.
 */

const row = (over: Partial<ReturnManifestRow> = {}): ReturnManifestRow => ({
  id: "m1",
  kind: "return",
  carrierId: "c1",
  code: "1791400000001",
  createdAt: "2026-10-08T09:00:00.000Z",
  carrierStatus: "ACCEPTED",
  closedAt: null,
  lines: [
    { state: "expected", orderId: "o1" },
    { state: "received", orderId: "o2" },
    { state: "damaged", orderId: "o3" },
    { state: "expected", orderId: null },
  ],
  ...over,
});

describe("summarizeReturnManifests", () => {
  it("counts each list's progress; damaged parcels were received too", () => {
    const { manifests } = summarizeReturnManifests([row()], 0);
    expect(manifests[0]).toMatchObject({ expected: 4, received: 2, damaged: 1, remaining: 2, missing: 0, state: "in_progress" });
  });

  it("an untouched list is new, a finished one complete", () => {
    const fresh = row({ lines: [{ state: "expected", orderId: "o1" }] });
    const done = row({ id: "m2", lines: [{ state: "received", orderId: "o1" }] });
    const { manifests } = summarizeReturnManifests([fresh, done], 0);
    expect(manifests.map((m) => m.state)).toEqual(["new", "complete"]);
  });

  it("a closed list with lines still expected has missing parcels", () => {
    const { manifests, totals } = summarizeReturnManifests([row({ closedAt: "2026-10-08T11:42:00.000Z" })], 0);
    expect(manifests[0]).toMatchObject({ missing: 2, state: "closed_missing" });
    expect(totals.missing).toBe(2);
    expect(totals.toReceive).toBe(0);
  });

  it("totals: what open lists still expect, and the set-aside count as given", () => {
    const { totals } = summarizeReturnManifests([row(), row({ id: "m2", closedAt: "2026-10-07T12:00:00Z" })], 3);
    expect(totals).toEqual({ toReceive: 2, missing: 2, setAside: 3, openLists: 1 });
  });

  it("removed lines do not count (they never apply to return lists, but a line is never invented)", () => {
    const { manifests } = summarizeReturnManifests([row({ lines: [{ state: "removed", orderId: "o1" }, { state: "expected", orderId: "o2" }] })], 0);
    expect(manifests[0].expected).toBe(1);
  });

  it("newest list first", () => {
    const { manifests } = summarizeReturnManifests(
      [row({ id: "old", createdAt: "2026-10-06T09:00:00Z" }), row({ id: "new", createdAt: "2026-10-08T09:00:00Z" })],
      0,
    );
    expect(manifests.map((m) => m.id)).toEqual(["new", "old"]);
  });
});
