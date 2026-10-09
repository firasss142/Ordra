import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { libyaScorecard, LY, TRI } from "@/test/helpers/scorecardFixture";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/fr/carriers",
  useSearchParams: () => new URLSearchParams("period=30"),
}));
const useCarrierScorecard = vi.fn();
vi.mock("@/hooks/useCarrierScorecard", () => ({
  useCarrierScorecard: (...a: unknown[]) => useCarrierScorecard(...a),
  useScorecardParcels: () => ({ parcels: [], isLoading: false, error: null }),
  buildScorecardParcelsKey: () => "/api/carriers/scorecard/parcels?x",
}));

import { CarrierScorecardWorkspace } from "../CarrierScorecardWorkspace";

/**
 * Transporteurs in « Aurore calme » (docs/design-system.md, as /performance/orders and
 * /team/performance): same screens and numbers, the page paints its own aurora under
 * `.tsc`, cards are glass, and each carrier account keeps its colour with presence.
 */

function renderWorkspace(screenName: "overview" | "carrier" | "compare", carrierId?: string) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <CarrierScorecardWorkspace screen={screenName} carrierId={carrierId} marketId={LY} marketCode="ly" locale="fr" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  useCarrierScorecard.mockReturnValue({ scorecard: libyaScorecard(), error: null, isLoading: false, mutate: vi.fn() });
});

describe("Transporteurs in Aurore", () => {
  it.each(["overview", "carrier", "compare"] as const)("paints its own ground under .tsc on %s", (s) => {
    const { container } = renderWorkspace(s, s === "carrier" ? TRI : undefined);
    const root = container.querySelector(".tsc");
    expect(root).not.toBeNull();
    expect(root?.className).not.toMatch(/bg-surface-page|bg-white/);
  });

  it("keeps the ground while loading", () => {
    useCarrierScorecard.mockReturnValue({ scorecard: null, error: null, isLoading: true, mutate: vi.fn() });
    const { container } = renderWorkspace("overview");
    expect(container.querySelector(".tsc [aria-busy=true]")).not.toBeNull();
  });

  it("opens on the breadcrumb Performance › Livraison, then the title", () => {
    renderWorkspace("overview");
    const nav = screen.getByRole("navigation", { name: "Fil d'Ariane" });
    expect(nav).toHaveTextContent(/Performance\s*›\s*Livraison/);
    expect(screen.getByRole("heading", { level: 1, name: "Transporteurs" })).toBeInTheDocument();
  });

  it("draws every section as a glass card", () => {
    renderWorkspace("overview");
    expect(screen.getByRole("region", { name: "Vue d'ensemble" })).toHaveClass("tsc-card");
  });

  it("gives each carrier card its colour with presence (band, wash, accent)", () => {
    renderWorkspace("overview");
    const card = screen.getByRole("article", { name: "Tripoli" });
    expect(card).toHaveClass("tsc-entity");
    expect(card).toHaveStyle({ "--c": "#1F5FBF" });
  });

  it("no longer carries the flat 2026-10-03 inks, greys and radii in its sources", () => {
    const dir = join(__dirname, "..");
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f));
    const flat = /#15171A|#5A5F66|#80868C|#EEF0F2|#1F2328|#ECEEF0|#E6E8EB|#16A34A|rounded-\[14px\]|bg-surface-page/i;
    const offenders = files.filter((f) => flat.test(readFileSync(join(dir, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
