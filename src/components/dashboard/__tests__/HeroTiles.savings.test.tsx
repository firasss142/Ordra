import { describe, test, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
  };
});

import { HeroTiles } from "../HeroTiles";
import type { DashboardHealth, SavingsBlock } from "@/lib/dashboard/health";
import type { Metric } from "@/lib/dashboard/confidence";

function metric(current: number): Metric {
  // deltaPct null + confidence "none" = no baseline, so no delta line renders.
  // These tiles are scenery for the savings tile under test.
  return { current, previous: 0, delta: 0, deltaPct: null, n: 0, confidence: "none" };
}

function health(savings: Partial<SavingsBlock>): DashboardHealth {
  return {
    period: { from: "2026-07-10", to: "2026-08-09" },
    scope: "single",
    selectedMarket: null,
    availableMarkets: [],
    money: {
      // Non-null revenue is what un-gates the money tiles (super_admin only).
      revenue: metric(1000),
      grossMargin: metric(400),
      marginPct: metric(40),
      costs: { cogs: 300, delivery: 200, returns: 50, packing: 50 },
      adSpend: null,
      isNetProfit: false,
    },
    funnel: {
      leads: metric(100),
      confirmed: metric(80),
      delivered: metric(60),
      returned: metric(10),
      rejected: metric(10),
      confirmationRate: metric(80),
      deliveryRate: metric(85),
      leadToCash: metric(60),
    },
    today: { received: 5, confirmed: 4, delivered: 3 },
    trailing7: { meanReceived: 4, meanConfirmed: 3 },
    committed: { value: 5000, count: 40 },
    savings: {
      total: 0,
      count: 0,
      wins: 0,
      losses: 0,
      periodTotal: 0,
      periodCount: 0,
      ...savings,
    },
    daily: [],
    flow: { intakePerDay: 0, confirmedPerDay: 0, netBacklogPerDay: 0 },
    queues: [],
    carriers: [],
    products: [],
    markets: [],
  };
}

function renderTiles(savings: Partial<SavingsBlock>) {
  return render(
    <HeroTiles health={health(savings)} currency="LYD" locale="fr" />,
  );
}

/** The savings tile's card element, so assertions can't leak into neighbours. */
function savingsTile(): HTMLElement {
  const label = screen.getByText("Économies livraison");
  const card = label.closest("div.rounded-card") ?? label.parentElement;
  if (!card) throw new Error("savings tile not found");
  return card as HTMLElement;
}

describe("HeroTiles — delivery savings tile", () => {
  test("replaces the committed-revenue tile", () => {
    renderTiles({ total: 340, count: 23, wins: 20, losses: 3 });
    expect(screen.getByText("Économies livraison")).toBeInTheDocument();
    expect(screen.queryByText("CA en attente")).not.toBeInTheDocument();
  });

  // A gain must read as a gain — the same tile also shows losses.
  test("renders a positive total with an explicit plus sign", () => {
    renderTiles({ total: 340, count: 23, wins: 20, losses: 3 });
    expect(screen.getByText("+340 LYD")).toBeInTheDocument();
  });

  test("renders a negative total with its minus sign", () => {
    renderTiles({ total: -125, count: 30, wins: 8, losses: 22 });
    expect(screen.getByText(/−125 LYD|-125 LYD/)).toBeInTheDocument();
  });

  test("splits the count into cheaper and dearer routings", () => {
    renderTiles({ total: 340, count: 23, wins: 20, losses: 3 });
    expect(screen.getByText("20 au moins cher · 3 plus cher")).toBeInTheDocument();
  });

  // Before the first dispatch under the recommendation there is nothing to
  // report. A "0 LYD" would read as "we saved nothing", which is not the claim.
  test("shows an em dash and an explanation before the first measured order", () => {
    renderTiles({ total: 0, count: 0 });
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("démarre au prochain envoi")).toBeInTheDocument();
    expect(screen.queryByText("0 LYD")).not.toBeInTheDocument();
  });

  test("shows the period contribution in the footer", () => {
    renderTiles({ total: 340, count: 23, wins: 20, losses: 3, periodTotal: 85, periodCount: 6 });
    expect(screen.getByText("+85 LYD sur 30 j")).toBeInTheDocument();
  });

  test("omits the footer when nothing was measured in the period", () => {
    renderTiles({ total: 340, count: 23, periodTotal: 0, periodCount: 0 });
    // Scoped to the savings tile: other tiles legitimately carry "sur 30 j"
    // footers of their own (funnel.overWeek, funnel.confirmRate).
    const tile = savingsTile();
    expect(within(tile).queryByText(/sur 30 j/)).not.toBeInTheDocument();
  });

  test("the footer belongs to the savings tile, not a neighbour", () => {
    renderTiles({ total: 340, count: 23, periodTotal: 85, periodCount: 6 });
    expect(within(savingsTile()).getByText("+85 LYD sur 30 j")).toBeInTheDocument();
  });

  test("a measured net of exactly zero still renders as a figure, not as empty", () => {
    // Every order went to a destination the two accounts price identically.
    renderTiles({ total: 0, count: 12, wins: 0, losses: 0 });
    expect(screen.getByText("0 LYD")).toBeInTheDocument();
    expect(screen.queryByText("démarre au prochain envoi")).not.toBeInTheDocument();
  });

  test("keeps the revenue and margin tiles alongside it", () => {
    renderTiles({ total: 340, count: 23 });
    expect(screen.getByText("Chiffre d'affaires")).toBeInTheDocument();
    expect(screen.getByText("Marge brute")).toBeInTheDocument();
  });
});
