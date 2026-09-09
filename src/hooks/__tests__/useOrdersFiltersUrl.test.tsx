import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const routerReplace = vi.fn();
let currentSearch = "";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
  usePathname: () => "/fr/orders",
  useRouter: () => ({ push: vi.fn(), replace: routerReplace, refresh: vi.fn() }),
}));

import { useOrdersFiltersUrl } from "@/hooks/useOrdersFiltersUrl";

/**
 * Filters live in the URL, but changing them must never round-trip to the
 * server. `router.replace` makes Next refetch the page's RSC payload — the
 * middleware calls GoTrue, page.tsx re-runs its count and agents queries — on
 * every facet click and every search pause. `window.history.replaceState`
 * updates the URL and `useSearchParams` without any of that, as long as the
 * state argument is `null`: Next's patched replaceState ignores a call whose
 * state already carries its own `__NA` marker.
 */
describe("useOrdersFiltersUrl", () => {
  let replaceState: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    currentSearch = "";
    routerReplace.mockClear();
    replaceState = vi.spyOn(window.history, "replaceState");
  });

  afterEach(() => {
    replaceState.mockRestore();
  });

  it("writes a filter change to the URL with history.replaceState and null state", () => {
    const { result } = renderHook(() => useOrdersFiltersUrl());

    act(() => {
      result.current.update({ q: "925782" });
    });

    expect(replaceState).toHaveBeenCalledTimes(1);
    const [state, , url] = replaceState.mock.calls[0];
    expect(state).toBeNull();
    expect(String(url)).toBe("/fr/orders?q=925782");
  });

  it("never calls router.replace", () => {
    const { result } = renderHook(() => useOrdersFiltersUrl());

    act(() => {
      result.current.update({ q: "salima" });
    });

    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("preserves the UI-only open and view params across a filter change", () => {
    currentSearch = "open=abc-123&view=table";
    const { result } = renderHook(() => useOrdersFiltersUrl());

    act(() => {
      result.current.update({ city: "Tripoli" });
    });

    const url = new URL(String(replaceState.mock.calls[0][2]), "http://x");
    expect(url.searchParams.get("open")).toBe("abc-123");
    expect(url.searchParams.get("view")).toBe("table");
    expect(url.searchParams.get("city")).toBe("Tripoli");
  });

  it("drops the query string entirely when every filter is back to default", () => {
    currentSearch = "q=abc";
    const { result } = renderHook(() => useOrdersFiltersUrl());

    act(() => {
      result.current.update({ q: "" });
    });

    expect(String(replaceState.mock.calls[0][2])).toBe("/fr/orders");
  });
});
