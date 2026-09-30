import { renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useWhatsAppAvailability } from "../useWhatsAppAvailability";

/**
 * Owner decision (2026-09-25): a market that is not connected shows WhatsApp
 * DISABLED, not hidden. So "the check failed" must read as "not connected"
 * (known, inactive), never as "still unknown" — otherwise an environment where
 * the check errors would hide every WhatsApp surface again.
 */
const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>
);

afterEach(() => vi.restoreAllMocks());

describe("useWhatsAppAvailability", () => {
  it("is unknown while loading, then active when the number is live", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { market_id: "m", connected: true, active: true, status: "active" } })));
    const { result } = renderHook(() => useWhatsAppAvailability("m"), { wrapper });
    expect(result.current.known).toBe(false);
    await waitFor(() => expect(result.current.known).toBe(true));
    expect(result.current.active).toBe(true);
  });

  it("a failed check is known and inactive", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "Internal server error" }), { status: 500 }));
    const { result } = renderHook(() => useWhatsAppAvailability("m"), { wrapper });
    await waitFor(() => expect(result.current.known).toBe(true));
    expect(result.current.active).toBe(false);
  });
});
