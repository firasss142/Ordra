import { describe, test, expect, vi } from "vitest";
import { resolveSiteFilter } from "../site-scope";

/**
 * Which building a warehouse request is about.
 *
 * Libya has two, and they are not interchangeable: a parcel uploaded to the
 * Benghazi Darb account is prepared in Benghazi and handed to Darb Benghazi.
 * An agent therefore sees exactly one site — their own — and cannot widen it
 * from the client. A manager sees both and narrows by choice.
 */
function client(site: string | null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: { warehouse_id: site }, error: null });
  return { from: vi.fn().mockReturnValue(chain) } as never;
}

describe("resolveSiteFilter", () => {
  test("pins a warehouse agent to their own site, whatever they ask for", async () => {
    const result = await resolveSiteFilter(client("site-benghazi"), {
      actor: { id: "adel", role: "warehouse_agent" },
      requested: "site-tripoli",
    });
    expect(result).toEqual({ warehouseId: "site-benghazi", pinned: true, unassigned: false });
  });

  /**
   * The inversion of 2026-09-09.
   *
   * This used to widen an unassigned agent to the whole market, on the reasoning
   * that an empty bench reads as a broken app. Production proved that reasoning
   * wrong: `tarek` had no site, so he saw all 405 Libyan parcels with both
   * buildings mixed, AND the SQL guard stayed inert for him (it only fires when
   * both sides carry a site). Unassigned therefore meant unrestricted — the exact
   * mistake the site model exists to prevent, wide open by default.
   *
   * An empty bench that explains itself is the lesser evil, and it is loud:
   * it gets the agent assigned instead of letting them mis-hand a parcel.
   */
  test("an unassigned agent sees NOTHING, not the whole market", async () => {
    const result = await resolveSiteFilter(client(null), {
      actor: { id: "new-agent", role: "warehouse_agent" },
      requested: null,
    });
    expect(result).toEqual({ warehouseId: null, pinned: true, unassigned: true });
  });

  test("an unassigned agent cannot widen by asking for a site", async () => {
    const result = await resolveSiteFilter(client(null), {
      actor: { id: "new-agent", role: "warehouse_agent" },
      requested: "site-tripoli",
    });
    expect(result.unassigned).toBe(true);
    expect(result.warehouseId).toBeNull();
  });

  test("a manager narrows by choice", async () => {
    const result = await resolveSiteFilter(client(null), {
      actor: { id: "mm", role: "market_manager" },
      requested: "site-tripoli",
    });
    expect(result).toEqual({ warehouseId: "site-tripoli", pinned: false, unassigned: false });
  });

  test("a manager who chooses nothing sees every site", async () => {
    const result = await resolveSiteFilter(client(null), {
      actor: { id: "mm", role: "market_manager" },
      requested: null,
    });
    expect(result).toEqual({ warehouseId: null, pinned: false, unassigned: false });
  });

  /** A manager is never "unassigned" — having no building is their normal state. */
  test("a manager with no site of their own is not unassigned", async () => {
    const result = await resolveSiteFilter(client(null), {
      actor: { id: "sa", role: "super_admin" },
      requested: null,
    });
    expect(result.unassigned).toBe(false);
  });

  test("'all' is not a site id", async () => {
    const result = await resolveSiteFilter(client(null), {
      actor: { id: "sa", role: "super_admin" },
      requested: "all",
    });
    expect(result.warehouseId).toBeNull();
  });

  test("does not query users for a role that has no site", async () => {
    const c = client(null);
    await resolveSiteFilter(c, { actor: { id: "mm", role: "market_manager" }, requested: null });
    expect((c as unknown as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
  });
});
