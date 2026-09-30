import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useBodyScrollLock } from "../useBodyScrollLock";

afterEach(() => {
  document.body.style.overflow = "";
});

describe("useBodyScrollLock", () => {
  it("holds the page still while active and gives it back afterwards", () => {
    const { unmount } = renderHook(() => useBodyScrollLock(true));
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("does nothing while inactive", () => {
    renderHook(() => useBodyScrollLock(false));
    expect(document.body.style.overflow).toBe("");
  });

  // The phone panel and the call sheet above it both lock. Closing on success
  // unmounts them in the same commit, panel first — a lock that restores "the
  // value it saw" would hand the sheet's "hidden" back to the page and leave
  // the queue unscrollable until a reload.
  it("releases only when the last of several stacked locks lets go, in any order", () => {
    const panel = renderHook(() => useBodyScrollLock(true));
    const sheet = renderHook(() => useBodyScrollLock(true));

    panel.unmount();
    expect(document.body.style.overflow).toBe("hidden");
    sheet.unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("restores whatever the page had before the first lock", () => {
    document.body.style.overflow = "scroll";
    const { unmount } = renderHook(() => useBodyScrollLock(true));
    unmount();
    expect(document.body.style.overflow).toBe("scroll");
  });
});
