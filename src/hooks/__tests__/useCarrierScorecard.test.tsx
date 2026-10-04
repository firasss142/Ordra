import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";
import {
  buildCarrierScorecardKey,
  buildScorecardParcelsKey,
  useCarrierScorecard,
  useScorecardParcels,
} from "@/hooks/useCarrierScorecard";

const LY = "00000000-0000-0000-0000-000000000002";

function wrapper({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}

const fetchMock = vi.fn((url: string) =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve(
        url.includes("/parcels")
          ? { data: [{ order_id: "o1", tracking_number: "1593038" }] }
          : { data: { market_id: LY, days: 30, carriers: [{ id: "c1" }], dormant: [] } },
      ),
  }),
);

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("useCarrierScorecard", () => {
  it("builds one key per market and period", () => {
    expect(buildCarrierScorecardKey(LY, 30)).toBe(`/api/carriers/scorecard?market_id=${LY}&days=30`);
    expect(buildScorecardParcelsKey(LY, "c1", "late")).toBe(`/api/carriers/scorecard/parcels?market_id=${LY}&carrier_id=c1&kind=late`);
  });

  it("returns the scorecard", async () => {
    const { result } = renderHook(() => useCarrierScorecard(LY, 30), { wrapper });
    await waitFor(() => expect(result.current.scorecard?.carriers[0].id).toBe("c1"));
  });

  it("asks nothing until the market is known", async () => {
    const { result } = renderHook(() => useCarrierScorecard(null, 30), { wrapper });
    expect(result.current.scorecard).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useScorecardParcels", () => {
  it("loads the parcels only when a drawer is open", async () => {
    const { result, rerender } = renderHook(
      ({ kind }: { kind: "late" | null }) => useScorecardParcels(LY, "c1", kind),
      { wrapper, initialProps: { kind: null as "late" | null } },
    );
    expect(fetchMock).not.toHaveBeenCalled();
    rerender({ kind: "late" });
    await waitFor(() => expect(result.current.parcels[0]?.tracking_number).toBe("1593038"));
  });
});
