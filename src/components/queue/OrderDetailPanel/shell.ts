/**
 * Where the order detail panel sits (prototypes/commandes-v4.html, the drawer).
 *
 *   "overlay" — the prototype's drawer: a scrim, then a 600px opaque column
 *               sliding in from the end side. The orders page.
 *   "side"    — the agent queue: a sticky card in the page grid beside the
 *               list on a desktop, the whole screen on a phone. No scrim — the
 *               queue stays readable beside it.
 *
 * The content is the same in both; only these classes change. They live in
 * commandes.css (the prototype's own) and panel.css (the side card), both
 * scoped under `.cmd`, which the root carries so the tokens apply anywhere.
 */
export type PanelVariant = "overlay" | "side";

export interface PanelShell {
  /** The `.cmd` token root — draws nothing, takes no grid cell. */
  root: string;
  /** Scrim classes, or null when the variant has no scrim. */
  overlay: string | null;
  panel: string;
}

export function panelShellClasses(variant: PanelVariant): PanelShell {
  if (variant === "overlay") {
    return { root: "cmd odp-root", overlay: "scrim odp-scrim", panel: "drawer odp" };
  }
  return { root: "cmd odp-root", overlay: null, panel: "odp-side odp" };
}
