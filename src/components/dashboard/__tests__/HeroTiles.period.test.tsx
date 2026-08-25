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
import { toMetric } from "@/lib/dashboard/confidence";
import type { DashboardHealth } from "@/lib/dashboard/health";

function health(over?: { leads?: [number, number]; confirmed?: [number, number] }): DashboardHealth {
  const [leads, prevLeads] = over?.leads ?? [52, 38];
  const [confirmed, prevConfirmed] = over?.confirmed ?? [18, 31];
  return {
    period: { from: "2026-07-15", to: "2026-08-13" },
    scope: "single",
    selectedMarket: null,
    availableMarkets: [],
    money: {
      revenue: toMetric(9610, 7500),
      grossMargin: toMetric(7527, 6700),
      marginPct: toMetric(78.3, 74.1, 200),
      costs: { cogs: 1200, delivery: 600, returns: 200, packing: 83 },
      adSpend: null,
      isNetProfit: false,
    },
    funnel: {
      leads: toMetric(leads, prevLeads),
      confirmed: toMetric(confirmed, prevConfirmed),
      delivered: toMetric(40, 30),
      returned: toMetric(6, 5),
      rejected: toMetric(4, 2),
      confirmationRate: toMetric(34.6, 40, 52),
      deliveryRate: toMetric(87, 85, 46),
      leadToCash: toMetric(77, 79, 52),
    },
    today: { received: 5, confirmed: 4, delivered: 3 },
    trailing7: { meanReceived: 4, meanConfirmed: 3 },
    committed: { value: 5000, count: 40 },
    savings: { total: -480, count: 60, wins: 20, losses: 40, periodTotal: -120, periodCount: 12 },
    daily: [],
    flow: { intakePerDay: 0, confirmedPerDay: 0, netBacklogPerDay: 0 },
    queues: [],
    carriers: [],
    products: [],
    markets: [],
  };
}

function renderTiles(over?: Parameters<typeof health>[0]) {
  return render(
    <HeroTiles
      health={health(over)}
      currency="LYD"
      locale="fr"
      comparisonLabel="vs 15 juin — 14 juil."
    />,
  );
}

/** A tile's card element, so assertions cannot leak into its neighbours. */
function tile(label: string): HTMLElement {
  const el = screen.getByText(label);
  const card = el.closest("div.rounded-card");
  if (!card) throw new Error(`tile "${label}" not found`);
  return card as HTMLElement;
}

describe("HeroTiles — period scoping", () => {
  /**
   * The volume tiles used to show TODAY's count against a trailing 7-day mean.
   * That was coherent on a page with one fixed window and is not coherent now
   * the header carries a 7/30/90 selector: a tile that ignores the control
   * above it reads as broken.
   */
  test("the volume tiles report the window, not today", () => {
    renderTiles();
    expect(within(tile("Commandes")).getByText("52")).toBeInTheDocument();
    expect(within(tile("Uploadées")).getByText("18")).toBeInTheDocument();
    expect(screen.queryByText("aujourd'hui")).not.toBeInTheDocument();
  });

  test("tiles with a trustworthy comparison name the baseline in dates", () => {
    renderTiles();
    // Commandes, Chiffre d'affaires, Marge brute. Uploadées is excluded on
    // purpose — see the next test.
    expect(screen.getAllByText("vs 15 juin — 14 juil.")).toHaveLength(3);
  });

  /**
   * The suppression rule is per tile, not per page. At n=18 the comparison is
   * still shown — a 42% fall in confirmations is the most important thing on
   * the page — but the caption swaps the baseline for the denominator, so the
   * reader knows the figure rests on eighteen orders before acting on it.
   */
  test("a low-confidence tile states its sample size instead of the baseline", () => {
    renderTiles();
    const card = tile("Uploadées");
    expect(within(card).getByText("sur 18 commandes")).toBeInTheDocument();
    expect(within(card).queryByText("vs 15 juin — 14 juil.")).not.toBeInTheDocument();
  });

  test("a rise and a fall get opposite pills", () => {
    renderTiles();
    expect(within(tile("Commandes")).getByText("↗ +36.8%")).toBeInTheDocument();
    expect(within(tile("Uploadées")).getByText("↘ −41.9%")).toBeInTheDocument();
  });

  // The suppression rule still governs the row: a thin window gets a caption
  // explaining why, and no coloured chip to argue with.
  test("suppresses the pill on a window too thin to compare", () => {
    renderTiles({ leads: [6, 40] });
    const card = tile("Commandes");
    expect(within(card).getByText("6 commandes — trop peu pour comparer")).toBeInTheDocument();
    expect(within(card).queryByText(/[↗↘]/)).not.toBeInTheDocument();
  });

  test("the upload rate stays with the uploaded tile", () => {
    renderTiles();
    expect(within(tile("Uploadées")).getByText("34.6% du flux uploadé")).toBeInTheDocument();
  });

  test("keeps the money tiles alongside the volume ones", () => {
    renderTiles();
    expect(screen.getByText("9 610 LYD")).toBeInTheDocument();
    expect(screen.getByText("7 527 LYD")).toBeInTheDocument();
    expect(screen.getByText("78.3%")).toBeInTheDocument();
  });

  // A negative net means the cheapest-account badge is being overridden more
  // often than followed — the one tile on the row allowed to turn amber.
  test("a negative savings net renders warm", () => {
    renderTiles();
    const card = tile("Économies livraison");
    expect(within(card).getByText("-480 LYD")).toHaveClass("text-oms-warn-ink");
  });
});
