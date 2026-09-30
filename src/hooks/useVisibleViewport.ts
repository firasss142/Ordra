"use client";

import { useEffect, useState } from "react";

export interface VisibleBox {
  /** Distance from the top of the layout viewport, in CSS px. */
  top: number;
  height: number;
}

/**
 * The part of the screen the on-screen keyboard leaves visible.
 *
 * A phone keyboard does not resize the layout viewport — iOS never has, and
 * Chrome stopped in v108 — so anything `fixed` to the bottom edge stays behind
 * the keys. A bottom sheet that pins its overlay to this box instead rides up
 * with the keyboard, so the field being typed in and the button under it stay
 * on screen.
 *
 * `null` while inactive or where the browser has no visual viewport; the
 * caller then keeps its plain `inset-0` geometry, which is also what a desktop
 * gets since its visual viewport never differs from the layout one.
 */
export function useVisibleViewport(active: boolean): VisibleBox | null {
  const [box, setBox] = useState<VisibleBox | null>(null);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!active || !vv) {
      setBox(null);
      return;
    }
    const read = () =>
      setBox((prev) =>
        prev && prev.top === vv.offsetTop && prev.height === vv.height
          ? prev
          : { top: vv.offsetTop, height: vv.height },
      );
    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    return () => {
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
    };
  }, [active]);

  return box;
}
