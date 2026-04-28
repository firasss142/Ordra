import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { TN_MARKET_ID, LY_MARKET_ID } from "@/lib/markets";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const swrMutateMock = vi.fn();
vi.mock("swr", () => ({
  useSWRConfig: () => ({ mutate: swrMutateMock }),
}));

import { MarketScopeProvider, useMarketScope } from "@/context/market-scope";

function Probe() {
  const { scope, marketId, setScope } = useMarketScope();
  return (
    <div>
      <span data-testid="scope">{scope}</span>
      <span data-testid="market-id">{marketId ?? "null"}</span>
      <button onClick={() => setScope("ly")}>set-ly</button>
      <button onClick={() => setScope("all")}>set-all</button>
    </div>
  );
}

beforeEach(() => {
  refreshMock.mockReset();
  swrMutateMock.mockReset();
  document.cookie = "oms_scope_market=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
});

afterEach(() => {
  document.cookie = "oms_scope_market=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
});

describe("MarketScopeProvider", () => {
  it("hydrates from initial scope", () => {
    render(
      <MarketScopeProvider initialScope="tn">
        <Probe />
      </MarketScopeProvider>,
    );
    expect(screen.getByTestId("scope").textContent).toBe("tn");
    expect(screen.getByTestId("market-id").textContent).toBe(TN_MARKET_ID);
  });

  it("hydrates initialScope=ly", () => {
    render(
      <MarketScopeProvider initialScope="ly">
        <Probe />
      </MarketScopeProvider>,
    );
    expect(screen.getByTestId("scope").textContent).toBe("ly");
    expect(screen.getByTestId("market-id").textContent).toBe(LY_MARKET_ID);
  });

  it("hydrates initialScope=all → null marketId", () => {
    render(
      <MarketScopeProvider initialScope="all">
        <Probe />
      </MarketScopeProvider>,
    );
    expect(screen.getByTestId("scope").textContent).toBe("all");
    expect(screen.getByTestId("market-id").textContent).toBe("null");
  });

  it("setScope writes the cookie", () => {
    render(
      <MarketScopeProvider initialScope="tn">
        <Probe />
      </MarketScopeProvider>,
    );
    act(() => {
      screen.getByText("set-ly").click();
    });
    expect(document.cookie).toContain("oms_scope_market=ly");
  });

  it("setScope updates the exposed scope value", () => {
    render(
      <MarketScopeProvider initialScope="tn">
        <Probe />
      </MarketScopeProvider>,
    );
    act(() => {
      screen.getByText("set-ly").click();
    });
    expect(screen.getByTestId("scope").textContent).toBe("ly");
    expect(screen.getByTestId("market-id").textContent).toBe(LY_MARKET_ID);
  });

  it("setScope triggers router.refresh and SWR mutate", () => {
    render(
      <MarketScopeProvider initialScope="tn">
        <Probe />
      </MarketScopeProvider>,
    );
    act(() => {
      screen.getByText("set-all").click();
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(swrMutateMock).toHaveBeenCalledTimes(1);
  });

  it("setScope to current value is a no-op (no refresh, no mutate)", () => {
    render(
      <MarketScopeProvider initialScope="ly">
        <Probe />
      </MarketScopeProvider>,
    );
    act(() => {
      screen.getByText("set-ly").click();
    });
    expect(refreshMock).not.toHaveBeenCalled();
    expect(swrMutateMock).not.toHaveBeenCalled();
  });
});
