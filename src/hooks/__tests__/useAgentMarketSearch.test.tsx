import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { SWRConfig } from "swr";
import React from "react";
import { useAgentMarketSearch } from "../useAgentMarketSearch";

const fetchMock = vi.fn();

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {children}
    </SWRConfig>
  );
}

const answer = (rows: { id: string }[], total = rows.length) => ({
  ok: true,
  status: 200,
  json: async () => ({ rows, total }),
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("useAgentMarketSearch", () => {
  test("asks nothing below three characters", async () => {
    const { result } = renderHook(() => useAgentMarketSearch("ah", true), { wrapper });
    await new Promise((r) => setTimeout(r, 300));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ rows: [], pending: false });
  });

  test("asks nothing while the dropdown is closed", async () => {
    renderHook(() => useAgentMarketSearch("salima", false), { wrapper });
    await new Promise((r) => setTimeout(r, 300));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("waits for the typing to pause, then asks once with the query encoded", async () => {
    fetchMock.mockResolvedValue(answer([{ id: "o1" }], 7));
    const { result } = renderHook(() => useAgentMarketSearch("أحمد 091", true), { wrapper });
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `/api/agent/search?q=${encodeURIComponent("أحمد 091")}`,
    );
    expect(result.current).toMatchObject({ total: 7, pending: false });
  });

  test("never shows the previous query's rows as the answer to the new one", async () => {
    fetchMock.mockResolvedValueOnce(answer([{ id: "old" }]));
    const { result, rerender } = renderHook(({ q }) => useAgentMarketSearch(q, true), {
      wrapper,
      initialProps: { q: "salima" },
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    let release: (v: unknown) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise((r) => (release = r)));
    rerender({ q: "salima sfax" });
    // Until the new answer lands: nothing from "salima", and say we are looking.
    expect(result.current.rows).toEqual([]);
    expect(result.current.pending).toBe(true);

    release(answer([{ id: "new" }]));
    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(["new"]));
  });
});
