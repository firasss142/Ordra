import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  verifyAndDeleteDuplicateSibling,
  DuplicateSiblingError,
} from "./duplicate-delete";
import type { Actor } from "@/lib/auth/actor";
import type { DuplicateEnrichment } from "@/lib/duplicate-orders/detect";

const ANCHOR_ID = "anchor-1";
const TARGET_ID = "sibling-1";
const MARKET = "market-a";

function makeAnchor(over: Record<string, unknown> = {}) {
  return {
    id: ANCHOR_ID,
    status: "pending",
    market_id: MARKET,
    assigned_to: "agent-1",
    customer_phone: "20999",
    customer_phone_2: null,
    product_id: "p-1",
    product_name: "T-Shirt",
    quantity: 1,
    created_at: "2026-05-21T10:00:00Z",
    ...over,
  };
}

function makeTargetRow(over: Record<string, unknown> = {}) {
  return {
    id: TARGET_ID,
    status: "pending",
    market_id: MARKET,
    tracking_number: null,
    carrier_id: null,
    ...over,
  };
}

/**
 * Minimal supabase stub: `from(table).select().eq().single()` resolves to a
 * per-table queue of responses so we can return the anchor then the target.
 */
function makeSupabase(rows: Record<string, { data: unknown; error: unknown }[]>) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.single = vi.fn().mockImplementation(() => {
        const next = rows[table]?.shift();
        return Promise.resolve(next ?? { data: null, error: { message: "no row" } });
      });
      return chain;
    },
  } as never;
}

const admin = {} as never;

function enrichWith(siblings: DuplicateEnrichment["duplicate_siblings"]) {
  return vi.fn().mockImplementation(async (_s, _m, anchorRows: { id: string }[]) =>
    anchorRows.map((r) => ({
      ...r,
      is_potential_duplicate: siblings.length > 0,
      duplicate_count: siblings.length,
      duplicate_siblings: siblings,
      has_uploaded_sibling: siblings.some((x) => x.already_shipped),
    })),
  );
}

function sibling(over: Record<string, unknown> = {}) {
  return {
    id: TARGET_ID,
    external_id: "EXT-1",
    status: "pending",
    created_at: "2026-05-21T09:00:00Z",
    product_name: "T-Shirt",
    quantity: 1,
    already_shipped: false,
    ...over,
  };
}

const agent: Actor = { id: "agent-1", role: "agent", market_id: MARKET };
const manager: Actor = { id: "mgr-1", role: "market_manager", market_id: MARKET };

beforeEach(() => vi.clearAllMocks());

describe("verifyAndDeleteDuplicateSibling", () => {
  test("404 when the anchor order does not exist", async () => {
    const supabase = makeSupabase({ orders: [{ data: null, error: { message: "x" } }] });
    await expect(
      verifyAndDeleteDuplicateSibling(supabase, admin, {
        anchorId: ANCHOR_ID,
        targetId: TARGET_ID,
        actor: agent,
        enrich: enrichWith([sibling()]),
        deleteOrders: vi.fn(),
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  test("404 when an agent operates on an anchor they do not own (no existence leak)", async () => {
    const supabase = makeSupabase({
      orders: [{ data: makeAnchor({ assigned_to: "someone-else" }), error: null }],
    });
    await expect(
      verifyAndDeleteDuplicateSibling(supabase, admin, {
        anchorId: ANCHOR_ID,
        targetId: TARGET_ID,
        actor: agent,
        enrich: enrichWith([sibling()]),
        deleteOrders: vi.fn(),
      }),
    ).rejects.toMatchObject({ status: 404, reason: "not_assigned_to_agent" });
  });

  test("422 when the target is NOT among the re-verified siblings (the core security gate)", async () => {
    const supabase = makeSupabase({ orders: [{ data: makeAnchor(), error: null }] });
    const deleteOrders = vi.fn();
    await expect(
      verifyAndDeleteDuplicateSibling(supabase, admin, {
        anchorId: ANCHOR_ID,
        targetId: "totally-unrelated-id",
        actor: agent,
        enrich: enrichWith([sibling({ id: "some-other-sibling" })]),
        deleteOrders,
      }),
    ).rejects.toMatchObject({ status: 422, reason: "not_a_duplicate_sibling" });
    expect(deleteOrders).not.toHaveBeenCalled();
  });

  test("403 when a manager operates cross-market", async () => {
    const supabase = makeSupabase({
      orders: [{ data: makeAnchor({ market_id: "market-b" }), error: null }],
    });
    await expect(
      verifyAndDeleteDuplicateSibling(supabase, admin, {
        anchorId: ANCHOR_ID,
        targetId: TARGET_ID,
        actor: manager,
        enrich: enrichWith([sibling()]),
        deleteOrders: vi.fn(),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  test("400 when the target's status is not manually-deletable", async () => {
    const supabase = makeSupabase({
      orders: [
        { data: makeAnchor(), error: null },
        { data: makeTargetRow({ status: "dispatched" }), error: null },
      ],
    });
    await expect(
      verifyAndDeleteDuplicateSibling(supabase, admin, {
        anchorId: ANCHOR_ID,
        targetId: TARGET_ID,
        actor: agent,
        enrich: enrichWith([sibling({ status: "dispatched" })]),
        deleteOrders: vi.fn(),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("happy path: agent deletes a verified sibling and gets the re-enriched anchor", async () => {
    const supabase = makeSupabase({
      orders: [
        { data: makeAnchor(), error: null },
        { data: makeTargetRow(), error: null },
      ],
    });
    const deleteOrders = vi.fn().mockResolvedValue({ deleted: 1 });
    const result = await verifyAndDeleteDuplicateSibling(supabase, admin, {
      anchorId: ANCHOR_ID,
      targetId: TARGET_ID,
      actor: agent,
      enrich: enrichWith([sibling()]),
      deleteOrders,
    });

    expect(deleteOrders).toHaveBeenCalledTimes(1);
    const call = deleteOrders.mock.calls[0][2];
    expect(call.orders).toHaveLength(1);
    expect(call.orders[0].id).toBe(TARGET_ID);
    expect(call.actorId).toBe("agent-1");
    expect(result.deleted_id).toBe(TARGET_ID);
    // anchor is re-enriched AFTER delete so the client can recount
    expect(result.anchor).toMatchObject({ is_potential_duplicate: expect.any(Boolean) });
  });

  test("wraps carrier-void / RPC failures from deleteOrders", async () => {
    const supabase = makeSupabase({
      orders: [
        { data: makeAnchor(), error: null },
        { data: makeTargetRow(), error: null },
      ],
    });
    const deleteOrders = vi.fn().mockRejectedValue(
      new DuplicateSiblingError("Carrier void failed", 409, "carrier_void_failed"),
    );
    await expect(
      verifyAndDeleteDuplicateSibling(supabase, admin, {
        anchorId: ANCHOR_ID,
        targetId: TARGET_ID,
        actor: agent,
        enrich: enrichWith([sibling()]),
        deleteOrders,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
