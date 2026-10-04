import { describe, it, expect } from "vitest";

import { panelShellClasses } from "../OrderDetailPanel/shell";

/**
 * prototypes/commandes-v4.html: one panel, two places. The orders page gets the
 * prototype's drawer over a scrim; the agent queue gets the same content as a
 * card beside the list. Only the shell differs, so its two shapes are pinned.
 */
describe("panelShellClasses", () => {
  it("is the prototype's drawer, over a scrim, on the orders page", () => {
    const { root, overlay, panel } = panelShellClasses("overlay");
    expect(root.split(" ")).toContain("cmd");
    expect(overlay?.split(" ")).toContain("scrim");
    expect(panel.split(" ")).toContain("drawer");
  });

  it("sits beside the list in the queue, with no scrim", () => {
    const { root, overlay, panel } = panelShellClasses("side");
    // The tokens must reach the agent queue too — they live on `.cmd`.
    expect(root.split(" ")).toContain("cmd");
    expect(overlay).toBeNull();
    expect(panel.split(" ")).toContain("odp-side");
    expect(panel.split(" ")).not.toContain("drawer");
  });

  it("shares one content class, so both shapes get the same panel", () => {
    expect(panelShellClasses("overlay").panel.split(" ")).toContain("odp");
    expect(panelShellClasses("side").panel.split(" ")).toContain("odp");
  });
});
