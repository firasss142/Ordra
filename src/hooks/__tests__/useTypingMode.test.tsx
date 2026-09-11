import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTypingMode, TYPING_IDLE_MS } from "../useTypingMode";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useTypingMode", () => {
  test("starts as viewing", () => {
    const { result } = renderHook(() => useTypingMode());
    expect(result.current.mode).toBe("viewing");
  });

  test("reports editing the moment activity is signalled", () => {
    const { result } = renderHook(() => useTypingMode());
    act(() => result.current.noteActivity());
    expect(result.current.mode).toBe("editing");
  });

  // The whole point: a latch that never releases would make the indicator lie.
  test("falls back to viewing once typing stops", () => {
    const { result } = renderHook(() => useTypingMode());
    act(() => result.current.noteActivity());
    act(() => { vi.advanceTimersByTime(TYPING_IDLE_MS + 50); });
    expect(result.current.mode).toBe("viewing");
  });

  test("continuous typing keeps it alive without flickering", () => {
    const { result } = renderHook(() => useTypingMode());
    for (let i = 0; i < 5; i++) {
      act(() => result.current.noteActivity());
      act(() => { vi.advanceTimersByTime(TYPING_IDLE_MS - 500); });
      expect(result.current.mode).toBe("editing");
    }
  });

  test("blur stops it immediately, without waiting out the timer", () => {
    const { result } = renderHook(() => useTypingMode());
    act(() => result.current.noteActivity());
    act(() => result.current.stop());
    expect(result.current.mode).toBe("viewing");
  });

  test("clears its timer on unmount", () => {
    const { result, unmount } = renderHook(() => useTypingMode());
    act(() => result.current.noteActivity());
    unmount();
    // No act() here on purpose: a surviving timer would setState after unmount.
    expect(() => vi.advanceTimersByTime(TYPING_IDLE_MS + 50)).not.toThrow();
  });
});
