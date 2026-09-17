import { describe, it, expect, vi } from "vitest";
import { bulkDeleteDuplicateSiblings, type BulkDeletePair } from "./duplicate-bulk-delete";
import { DuplicateSiblingError } from "./duplicate-delete";

const ACTOR = { id: "manager-1", role: "market_manager" as const, market_id: "m-1" };

function pair(o: Partial<BulkDeletePair> = {}): BulkDeletePair {
  return { anchor_id: "anchor-1", sibling_id: "sib-1", ...o };
}

describe("bulkDeleteDuplicateSiblings", () => {
  /**
   * The whole point of the bulk path: it must loop the EXISTING 8-step gate
   * rather than reimplement it. If it ever stops calling
   * verifyAndDeleteDuplicateSibling, the server-side re-derivation of siblings
   * is gone and a forged sibling_id would be deleted on the client's say-so.
   */
  it("delegates every pair to the verified single-sibling delete", async () => {
    const verify = vi.fn().mockResolvedValue({ deleted_id: "x", anchor: {} });
    await bulkDeleteDuplicateSiblings({} as never, {} as never, {
      pairs: [pair({ sibling_id: "a" }), pair({ sibling_id: "b" })],
      actor: ACTOR,
      verify,
    });
    expect(verify).toHaveBeenCalledTimes(2);
    expect(verify.mock.calls[0][2]).toMatchObject({
      anchorId: "anchor-1",
      targetId: "a",
      actor: ACTOR,
    });
  });

  it("reports each deleted sibling in succeeded", async () => {
    const verify = vi.fn().mockResolvedValue({ deleted_id: "sib-1", anchor: {} });
    const res = await bulkDeleteDuplicateSiblings({} as never, {} as never, {
      pairs: [pair()],
      actor: ACTOR,
      verify,
    });
    expect(res.succeeded).toEqual([{ order_id: "sib-1" }]);
    expect(res.failed).toEqual([]);
  });

  /**
   * Partial success is the contract: one bad pair must not sink the batch.
   * A manager selecting twenty duplicates should not lose nineteen deletions
   * because the twentieth was picked up by an agent a second earlier.
   */
  it("keeps going after a failure and records the reason per item", async () => {
    const verify = vi
      .fn()
      .mockResolvedValueOnce({ deleted_id: "ok-1", anchor: {} })
      .mockRejectedValueOnce(
        new DuplicateSiblingError("nope", 422, "not_a_duplicate_sibling"),
      )
      .mockResolvedValueOnce({ deleted_id: "ok-2", anchor: {} });

    const res = await bulkDeleteDuplicateSiblings({} as never, {} as never, {
      pairs: [
        pair({ sibling_id: "ok-1" }),
        pair({ sibling_id: "bad" }),
        pair({ sibling_id: "ok-2" }),
      ],
      actor: ACTOR,
      verify,
    });

    expect(res.succeeded.map((s) => s.order_id)).toEqual(["ok-1", "ok-2"]);
    expect(res.failed).toEqual([
      { order_id: "bad", reason: "not_a_duplicate_sibling", error: "nope" },
    ]);
  });

  it("labels an unexpected error as internal_error rather than leaking it", async () => {
    const verify = vi.fn().mockRejectedValue(new Error("kaboom"));
    const res = await bulkDeleteDuplicateSiblings({} as never, {} as never, {
      pairs: [pair({ sibling_id: "x" })],
      actor: ACTOR,
      verify,
    });
    expect(res.failed).toEqual([
      { order_id: "x", reason: "internal_error", error: "Internal server error" },
    ]);
  });

  it("deletes each sibling once even when the caller repeats it", async () => {
    const verify = vi.fn().mockResolvedValue({ deleted_id: "dup", anchor: {} });
    const res = await bulkDeleteDuplicateSiblings({} as never, {} as never, {
      pairs: [pair({ sibling_id: "dup" }), pair({ sibling_id: "dup" })],
      actor: ACTOR,
      verify,
    });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(res.succeeded).toHaveLength(1);
  });

  /**
   * Sequential, not Promise.all. Each delete runs manual_delete_orders and can
   * trip the order-presence lock; firing twenty at once turns one held order
   * into twenty contended writes.
   */
  it("processes pairs one at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const verify = vi.fn().mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { deleted_id: "x", anchor: {} };
    });
    await bulkDeleteDuplicateSiblings({} as never, {} as never, {
      pairs: [pair({ sibling_id: "a" }), pair({ sibling_id: "b" }), pair({ sibling_id: "c" })],
      actor: ACTOR,
      verify,
    });
    expect(maxInFlight).toBe(1);
  });

  it("returns an empty result for an empty batch without calling the gate", async () => {
    const verify = vi.fn();
    const res = await bulkDeleteDuplicateSiblings({} as never, {} as never, {
      pairs: [],
      actor: ACTOR,
      verify,
    });
    expect(verify).not.toHaveBeenCalled();
    expect(res).toEqual({ succeeded: [], failed: [] });
  });
});
