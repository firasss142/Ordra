import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";

import { panelShellClasses } from "../OrderDetailPanel/shell";

afterEach(() => vi.restoreAllMocks());

/**
 * Rev 2 (2026-09-18): on desktop the panel opens beside the list instead of
 * over it. Only the shell moves — the panel's content is untouched — so the
 * contract worth pinning is the shell's two shapes.
 */
describe("panelShellClasses", () => {
  it("overlays the page in the default (phone / fallback) variant", () => {
    const { overlay, panel } = panelShellClasses("overlay");
    expect(overlay).not.toBeNull();
    expect(panel).toMatch(/fixed/);
    expect(panel).toMatch(/z-50/);
  });

  it("sits in the page flow beside the list in the side variant", () => {
    const { overlay, panel } = panelShellClasses("side");
    // No scrim: the list stays readable and clickable next to the panel.
    expect(overlay).toBeNull();
    // No *unprefixed* `fixed`: the desktop shape is in flow. The `max-lg:fixed`
    // fallback below is deliberate and asserted separately.
    expect(panel.split(/\s+/)).not.toContain("fixed");
    expect(panel).toMatch(/lg:sticky/);
  });

  it("stops at its content on a desktop, rather than reserving a column of white", () => {
    // A fixed `h-[calc(100vh-…)]` made every short order end in a band of
    // empty panel between the receipt and the buttons that act on it.
    const { panel } = panelShellClasses("side");
    expect(panel).toMatch(/lg:max-h-\[calc\(100vh/);
    expect(panel).not.toMatch(/lg:h-\[calc\(100vh/);
  });

  it("keeps the panel full-width over the page on small screens in both variants", () => {
    // Below lg there is no room for two columns, so `side` still covers.
    const { panel } = panelShellClasses("side");
    expect(panel).toMatch(/max-lg:fixed/);
  });
});
