import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Boxes, LayoutDashboard, Package, PackageOpen } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/messages/fr.json";
import arMessages from "@/messages/ar.json";
import { WarehouseBottomBar, type BottomTab } from "../WarehouseBottomBar";

let pathname = "/fr/warehouse";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("swr", () => ({ preload: vi.fn() }));

/**
 * The agent's whole navigation.
 *
 * A warehouse agent has no sidebar, so this bar is the only way off the screen
 * they are on. It is operated with a thumb, by someone holding a parcel in the
 * other hand — which is why the target is the whole cell, not the label.
 */
const TABS = [
  { href: "/fr/warehouse", label: "Aujourd'hui", icon: LayoutDashboard, exact: true },
  { href: "/fr/warehouse/preparation", label: "Préparation", icon: Package },
  { href: "/fr/warehouse/returns", label: "Retours", icon: PackageOpen },
  { href: "/fr/warehouse/stock", label: "Stock", icon: Boxes },
];

/** The bar names its own landmark, so it needs the messages like any other component. */
function renderBar(tabs: BottomTab[], locale: "fr" | "ar" = "fr") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "ar" ? arMessages : frMessages}>
      <WarehouseBottomBar tabs={tabs} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => { pathname = "/fr/warehouse"; });
afterEach(cleanup);

describe("WarehouseBottomBar", () => {
  it("renders every section as a labelled destination", () => {
    renderBar(TABS);
    for (const t of TABS) expect(screen.getByRole("link", { name: t.label })).toBeInTheDocument();
  });

  it("marks the current section, and only that one", () => {
    pathname = "/fr/warehouse/returns";
    renderBar(TABS);
    expect(screen.getByRole("link", { name: "Retours" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Stock" })).not.toHaveAttribute("aria-current");
  });

  it("does not mark the index as current on a child route", () => {
    // `/fr/warehouse` is a prefix of every other route in the section, so
    // without an exact match it reads as active on every screen.
    pathname = "/fr/warehouse/stock";
    renderBar(TABS);
    expect(screen.getByRole("link", { name: "Aujourd'hui" })).not.toHaveAttribute("aria-current");
  });

  it("gives every target at least 44px of height for a thumb", () => {
    renderBar(TABS);
    const link = screen.getByRole("link", { name: "Stock" });
    expect(link.className).toMatch(/min-h-\[56px\]/);
  });

  it("clears the home indicator with a safe-area inset", () => {
    // Without this the last row of labels sits under the iOS gesture bar.
    renderBar(TABS);
    // The inset lives in a class (globals.css) rather than inline: jsdom
    // drops env() from a style attribute, so inline it could not be pinned.
    expect(screen.getByTestId("wh-bottom-bar").className).toContain("wh-safe-bottom");
  });

  it("carries a count badge when a section has work waiting", () => {
    renderBar(TABS.map((t) => (t.label === "Retours" ? { ...t, count: 50 } : t)));
    expect(screen.getByTestId("wh-tab-count-Retours").textContent).toBe("50");
  });

  it("caps a large count rather than breaking the cell", () => {
    renderBar(TABS.map((t) => (t.label === "Stock" ? { ...t, count: 1240 } : t)));
    expect(screen.getByTestId("wh-tab-count-Stock").textContent).toBe("99+");
  });

  it("places the scan action in the middle of the bar, between the four jobs' tabs", () => {
    // Scanning is what an agent does all day: it sits under the thumb, in the
    // centre, not in a quarter of the bar and not floating over the content.
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <WarehouseBottomBar tabs={TABS} center={<a href="/fr/warehouse/out?scan=1">Scanner</a>} />
      </NextIntlClientProvider>,
    );
    const names = screen.getAllByRole("link").map((a) => a.textContent);
    expect(names).toEqual(["Aujourd'hui", "Préparation", "Scanner", "Retours", "Stock"]);
  });

  it("tints the current tab with its job's hue", () => {
    pathname = "/fr/warehouse/returns";
    renderBar(TABS.map((t) => (t.label === "Retours" ? { ...t, hue: "job-returns" } : t)));
    expect(screen.getByRole("link", { name: "Retours" }).className).toContain("job-returns");
  });

  it("names its landmark in the agent's language", () => {
    renderBar(TABS, "fr");
    expect(screen.getByRole("navigation", { name: "Entrepôt" })).toBeInTheDocument();
    cleanup();
    renderBar(TABS, "ar");
    expect(screen.getByRole("navigation", { name: "المستودع" })).toBeInTheDocument();
  });
});
