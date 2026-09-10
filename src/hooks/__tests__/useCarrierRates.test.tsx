import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";
import { useCarrierRates } from "@/hooks/useCarrierRates";

const ORDER = "order-1";

/** Rates that differ per destination, the way the two Darb accounts really do. */
const BY_DEST: Record<string, { rec: string; fee: number }> = {
  "darb:18": { rec: "tripoli", fee: 20 },  // الخمس  — Tripoli cheaper
  "darb:78": { rec: "benghazi", fee: 10 }, // بنغازي — Benghazi cheaper
};

function wrapper({ children }: { children: ReactNode }) {
  // No provider cache reset between renders inside one test: that is the point —
  // the bug was SWR serving a cached answer under an unchanged key.
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const dest = new URL(url, "http://x").searchParams.get("dest") ?? "";
      const hit = BY_DEST[dest] ?? { rec: "none", fee: 0 };
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              recommended_carrier_id: hit.rec,
              reason: "quote",
              rates: [
                {
                  carrier_id: hit.rec,
                  quoted_fee: hit.fee,
                  quote_usable: true,
                  true_cost_per_delivered: null,
                  effective_cost: hit.fee,
                  is_cheapest: true,
                },
              ],
            },
          }),
      });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("useCarrierRates — the quote follows the destination", () => {
  it("asks again when the destination changes, and returns the new answer", async () => {
    const { result, rerender } = renderHook(
      ({ dest }: { dest: string | null }) => useCarrierRates(ORDER, true, dest),
      { wrapper, initialProps: { dest: "darb:18" } },
    );

    await waitFor(() => expect(result.current.recommendedCarrierId).toBe("tripoli"));
    expect(result.current.ratesByCarrierId.tripoli.quotedFee).toBe(20);

    // Moving the order east must move the recommendation. Before the
    // destination joined the key, SWR answered from cache and the badge kept
    // quoting Tripoli's price for a Benghazi address.
    rerender({ dest: "darb:78" });
    await waitFor(() => expect(result.current.recommendedCarrierId).toBe("benghazi"));
    expect(result.current.ratesByCarrierId.benghazi.quotedFee).toBe(10);
  });

  it("puts the destination in the request so two destinations are two cache entries", async () => {
    const { rerender } = renderHook(
      ({ dest }: { dest: string | null }) => useCarrierRates(ORDER, true, dest),
      { wrapper, initialProps: { dest: "darb:18" } },
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    rerender({ dest: "darb:78" });
    await waitFor(() => expect((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(2));

    const urls = (fetch as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[0]);
    expect(urls[0]).toContain(`order_id=${ORDER}`);
    expect(urls[0]).toContain("dest=darb%3A18");
    expect(urls[1]).toContain("dest=darb%3A78");
  });

  it("fetches nothing when disabled", async () => {
    renderHook(() => useCarrierRates(ORDER, false, "darb:18"), { wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still works for an order with no destination bound yet", async () => {
    const { result } = renderHook(() => useCarrierRates(ORDER, true, null), { wrapper });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    // A null destination is a legitimate state (unmatched city on intake), not
    // a reason to skip the request — the route falls back to sticker pricing.
    expect((fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]).toContain(
      `order_id=${ORDER}`,
    );
    expect(result.current.isLoading).toBe(false);
  });
});
