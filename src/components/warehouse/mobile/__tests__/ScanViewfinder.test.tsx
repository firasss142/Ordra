import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ScanViewfinder } from "../ScanViewfinder";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
  };
});

/**
 * The viewfinder (mockup 02).
 *
 * The camera used to open as a full-screen black modal over the page. On a
 * phone that hid the one thing the agent needs beside the picture — which
 * coloured roll to reach for — so the frame is now part of the page.
 */
afterEach(cleanup);

describe("ScanViewfinder", () => {
  it("frames the shot with four corner brackets", () => {
    render(<ScanViewfinder />);
    expect(screen.getByTestId("wm-viewfinder").querySelectorAll("[data-corner]")).toHaveLength(4);
  });

  it("keeps its aspect so the page does not jump when the camera starts", () => {
    // Without a reserved box the card collapses to zero height until the
    // video track arrives, then shoves everything below it down the page.
    render(<ScanViewfinder />);
    expect(screen.getByTestId("wm-viewfinder").className).toMatch(/aspect-\[/);
  });

  it("shows the success pill only when a scan actually bound", () => {
    const { rerender } = render(<ScanViewfinder />);
    expect(screen.queryByTestId("wm-scan-success")).toBeNull();
    rerender(<ScanViewfinder success="000123456" />);
    expect(screen.getByTestId("wm-scan-success").textContent).toContain("000123456");
  });

  it("says the camera is starting rather than showing an empty black box", () => {
    render(<ScanViewfinder starting />);
    expect(screen.getByTestId("wm-viewfinder").textContent).toMatch(/démarrage/i);
  });

  it("surfaces a camera failure in the frame, where the agent is looking", () => {
    render(<ScanViewfinder error="Accès refusé" />);
    expect(screen.getByRole("alert").textContent).toContain("Accès refusé");
  });

  it("renders the video mount point for html5-qrcode to attach to", () => {
    render(<ScanViewfinder readerId="oms-qr-reader" />);
    expect(document.getElementById("oms-qr-reader")).not.toBeNull();
  });

  it("hides the decorative chrome from assistive tech", () => {
    render(<ScanViewfinder />);
    const corners = screen.getByTestId("wm-viewfinder").querySelectorAll("[data-corner]");
    corners.forEach((c) => expect(c.getAttribute("aria-hidden")).toBe("true"));
  });
});
