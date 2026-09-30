/**
 * Where the order detail panel sits.
 *
 * Rev 2 (2026-09-18): on desktop the panel opens *beside* the queue rather than
 * over them, so an agent can keep reading the list while one order is open. The
 * panel's content did not change — only this shell — which is why the two
 * shapes live in one small module the panel and its tests both read.
 *
 *   "overlay" — the original slide-over: a scrim plus a fixed end-anchored
 *               column. Still used wherever there is no room for two columns.
 *   "side"    — a sticky column in the page grid, no scrim. Below `lg` it falls
 *               back to the overlay shape, because a phone has one column.
 */
export type PanelVariant = "overlay" | "side";

export interface PanelShell {
  /** Scrim classes, or null when the variant has no scrim. */
  overlay: string | null;
  panel: string;
}

const SLIDE_OVER =
  "fixed top-0 end-0 h-full w-full sm:w-[560px] z-50 flex flex-col overflow-hidden " +
  "bg-surface-card border-s border-line-subtle shadow-panel animate-[slideInEnd_180ms_ease-out]";

export function panelShellClasses(variant: PanelVariant): PanelShell {
  if (variant === "overlay") {
    return { overlay: "fixed inset-0 z-40 bg-ink-primary/40", panel: SLIDE_OVER };
  }

  return {
    overlay: null,
    panel: [
      // Phone and tablet keep the slide-over: one column has no room to split.
      "max-lg:fixed max-lg:top-0 max-lg:end-0 max-lg:h-full max-lg:w-full max-lg:z-50",
      "max-lg:shadow-panel max-lg:animate-[slideInEnd_180ms_ease-out] max-lg:border-s",
      // Desktop: a sticky column beside the list, matching the delivery page's
      // aside geometry (top-4, viewport minus the header band). `max-h`, not
      // `h`: a short order should end where its buttons end. Pinning the
      // height put a band of empty panel between the receipt and the footer
      // on every order with one line item, which is most of them.
      "lg:sticky lg:top-4 lg:max-h-[calc(100vh-88px)] lg:rounded-xl lg:border lg:me-5",
      // Vertical settle rather than a slide: the list column is resizing at the
      // same moment, and two directions of movement read as a jump.
      "lg:animate-[panelSettle_200ms_ease-out] lg:shadow-[0_1px_2px_rgba(17,24,39,0.04)]",
      "flex flex-col overflow-hidden bg-surface-card border-line-subtle",
    ].join(" "),
  };
}
