import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useVisibleViewport } from "../useVisibleViewport";

class FakeVisualViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
}

let vv: FakeVisualViewport;
const original = Object.getOwnPropertyDescriptor(window, "visualViewport");

beforeEach(() => {
  vv = new FakeVisualViewport();
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
});

afterEach(() => {
  if (original) Object.defineProperty(window, "visualViewport", original);
  else delete (window as { visualViewport?: unknown }).visualViewport;
});

describe("useVisibleViewport", () => {
  // A phone keyboard does not resize the layout viewport (iOS never, Chrome
  // since 108), so a `fixed bottom-0` sheet stays behind it — the note field
  // and « Confirmer le rejet » under the keys. The visual viewport is the part
  // of the screen the keyboard left; the sheet is pinned to that instead.
  it("follows the part of the screen the keyboard leaves visible", () => {
    const { result } = renderHook(() => useVisibleViewport(true));
    expect(result.current).toEqual({ top: 0, height: 800 });

    act(() => {
      vv.height = 460;
      vv.offsetTop = 120;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toEqual({ top: 120, height: 460 });

    act(() => {
      vv.offsetTop = 60;
      vv.dispatchEvent(new Event("scroll"));
    });
    expect(result.current).toEqual({ top: 60, height: 460 });
  });

  it("stays out of the way while inactive", () => {
    const { result } = renderHook(() => useVisibleViewport(false));
    expect(result.current).toBeNull();
  });

  it("stays out of the way where the browser has no visual viewport", () => {
    delete (window as { visualViewport?: unknown }).visualViewport;
    const { result } = renderHook(() => useVisibleViewport(true));
    expect(result.current).toBeNull();
  });
});
