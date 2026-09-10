import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSettledValue } from "@/hooks/useSettledValue";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useSettledValue", () => {
  it("returns the value immediately on first render", () => {
    // The first paint must not wait: a page loaded with filters in the URL
    // needs its facet counts straight away.
    const { result } = renderHook(() => useSettledValue("a", 500));
    expect(result.current).toBe("a");
  });

  it("holds the previous value until the input stops changing", () => {
    const { result, rerender } = renderHook(
      ({ v }: { v: string }) => useSettledValue(v, 500),
      { initialProps: { v: "a" } },
    );

    rerender({ v: "ab" });
    act(() => { vi.advanceTimersByTime(200); });
    rerender({ v: "abc" });
    act(() => { vi.advanceTimersByTime(200); });
    // Still mid-typing: the expensive companion request must not have moved.
    expect(result.current).toBe("a");

    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current).toBe("abc");
  });

  it("skips the intermediate values entirely", () => {
    const seen: string[] = [];
    const { rerender } = renderHook(
      ({ v }: { v: string }) => {
        seen.push(useSettledValue(v, 500));
        return null;
      },
      { initialProps: { v: "0" } },
    );
    for (const v of ["06", "065", "0651", "06512", "065123"]) {
      rerender({ v });
      act(() => { vi.advanceTimersByTime(100); });
    }
    act(() => { vi.advanceTimersByTime(500); });

    // Typing a phone number must cost ONE settled value, not one per keystroke.
    expect(new Set(seen)).toEqual(new Set(["0", "065123"]));
  });

  it("does not re-emit when the value returns to what it already was", () => {
    const { result, rerender } = renderHook(
      ({ v }: { v: string }) => useSettledValue(v, 500),
      { initialProps: { v: "a" } },
    );
    rerender({ v: "b" });
    rerender({ v: "a" });
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current).toBe("a");
  });
});
