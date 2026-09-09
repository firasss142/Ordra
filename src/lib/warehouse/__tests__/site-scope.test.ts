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
    expect(result).toEqual({ warehouseId: "site-benghazi", pinned: true });
  });

  test("an unassigned agent sees the whole market rather than nothing", async () => {
    // Until a manager assigns them, an empty bench would read as a broken app.
    const result = await resolveSiteFilter(client(null), {
      actor: { id: "new-agent", role: "warehouse_agent" },
      requested: null,
    });
    expect(result).toEqual({ warehouseId: null, pinned: false });
  });

  test("a manager narrows by choice", async () => {
    const result = await resolveSiteFilter(client(null), {
      actor: { id: "mm", role: "market_manager" },
      requested: "site-tripoli",
    });
    expect(result).toEqual({ warehouseId: "site-tripoli", pinned: false });
  });

  test("a manager who chooses nothing sees every site", async () => {
    const result = await resolveSiteFilter(client(null), {
      actor: { id: "mm", role: "market_manager" },
      requested: null,
    });
    expect(result).toEqual({ warehouseId: null, pinned: false });
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
