import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ScanFab } from "../ScanFab";

let pathname = "/fr/warehouse";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

/**
 * The scan button.
 *
 * Scanning is the one thing a warehouse agent does continuously, so it does
 * not share a quarter of the tab bar with four other destinations — it floats
 * above them, in the corner a thumb reaches without regripping the phone.
 */
afterEach(() => { cleanup(); pathname = "/fr/warehouse"; });

describe("ScanFab", () => {
  it("is a labelled link to the scan station", () => {
    render(<ScanFab href="/fr/warehouse/scan" label="Scanner" />);
    expect(screen.getByRole("link", { name: "Scanner" })).toHaveAttribute("href", "/fr/warehouse/scan");
  });

  it("clears the tab bar so it cannot cover a destination", () => {
    render(<ScanFab href="/fr/warehouse/scan" label="Scanner" />);
    // The bar is 56px plus the safe-area inset; the button sits above both.
    expect(screen.getByTestId("wh-scan-fab").className).toMatch(/bottom-\[/);
  });

  it("disappears on the scan screen itself", () => {
    // A button that navigates to where you already are is noise, and on a
    // 390px viewport it would cover the viewfinder.
    pathname = "/fr/warehouse/scan";
    render(<ScanFab href="/fr/warehouse/scan" label="Scanner" />);
    expect(screen.queryByTestId("wh-scan-fab")).toBeNull();
  });

  it("gives the touch target at least 48px", () => {
    render(<ScanFab href="/fr/warehouse/scan" label="Scanner" />);
    expect(screen.getByTestId("wh-scan-fab").className).toMatch(/min-h-\[52px\]/);
  });
});
