import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ScanButton } from "../ScanButton";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

/**
 * The scan action, in the centre of the agent's bar.
 *
 * It replaced a floating button that sat over the content: at 390px it covered
 * the last card of every list. In the bar it covers nothing and is still the
 * one filled green on the screen.
 */
afterEach(cleanup);

describe("ScanButton", () => {
  it("is a labelled link to the scanner", () => {
    render(<ScanButton href="/fr/warehouse/out?scan=1" label="Scanner" />);
    expect(screen.getByRole("link", { name: "Scanner" })).toHaveAttribute("href", "/fr/warehouse/out?scan=1");
  });

  it("lives in the bar, not floating over the content", () => {
    render(<ScanButton href="/fr/warehouse/out?scan=1" label="Scanner" />);
    expect(screen.getByRole("link", { name: "Scanner" }).className).not.toMatch(/\bfixed\b/);
  });

  it("shows its label under the button, so it reads without the icon", () => {
    render(<ScanButton href="/fr/warehouse/out?scan=1" label="Scanner" />);
    expect(screen.getByText("Scanner")).toBeVisible();
  });
});
