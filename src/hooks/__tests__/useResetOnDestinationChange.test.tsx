import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useResetOnDestinationChange } from "@/hooks/useResetOnDestinationChange";

describe("useResetOnDestinationChange", () => {
  it("does not clear the selection on first render", () => {
    const reset = vi.fn();
    renderHook(() => useResetOnDestinationChange("darb:18", reset));
    // Mounting is not a destination change. Clearing here would fight the
    // auto-select effect and could blank a choice the agent just made.
    expect(reset).not.toHaveBeenCalled();
  });

  it("clears the selection when the destination actually changes", () => {
    const reset = vi.fn();
    const { rerender } = renderHook(
      ({ dest }: { dest: string }) => useResetOnDestinationChange(dest, reset),
      { initialProps: { dest: "darb:18" } },
    );
    rerender({ dest: "darb:78" });
    // pickInitialCarrier's first rule is "the current selection always wins",
    // so without this the price flips to the new address while the recommended
    // account stays on the old one.
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("stays quiet while the destination is unchanged", () => {
    const reset = vi.fn();
    const { rerender } = renderHook(
      ({ dest }: { dest: string }) => useResetOnDestinationChange(dest, reset),
      { initialProps: { dest: "darb:18" } },
    );
    rerender({ dest: "darb:18" });
    rerender({ dest: "darb:18" });
    expect(reset).not.toHaveBeenCalled();
  });

  it("clears again on each further change", () => {
    const reset = vi.fn();
    const { rerender } = renderHook(
      ({ dest }: { dest: string }) => useResetOnDestinationChange(dest, reset),
      { initialProps: { dest: "darb:18" } },
    );
    rerender({ dest: "darb:78" });
    rerender({ dest: "city:tripoli" });
    expect(reset).toHaveBeenCalledTimes(2);
  });

  it("uses the latest callback without treating it as a change", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ dest, cb }: { dest: string; cb: () => void }) => useResetOnDestinationChange(dest, cb),
      { initialProps: { dest: "darb:18", cb: first } },
    );
    // A new inline callback every render must not, by itself, clear anything.
    rerender({ dest: "darb:18", cb: second });
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    rerender({ dest: "darb:78", cb: second });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
