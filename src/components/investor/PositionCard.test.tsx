import { describe, test, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import frMessages from "@/messages/fr.json";
import { PositionCard } from "./PositionCard";
import type { PositionSummary } from "@/lib/investors/portfolio";
// Les montants portent des isolats bidi et des espaces insécables invisibles
// dans un littéral : on assert via le matcher partagé. Voir test/helpers/money.
import { money } from "@/test/helpers/money";

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace?: string) =>
    (key: string, params?: Record<string, unknown>) => {
      const parts = namespace ? `${namespace}.${key}`.split(".") : key.split(".");
      let val: unknown = frMessages;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      if (typeof val !== "string") return key;
      return params
        ? Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), val)
        : val;
    },
  useLocale: () => "fr",
}));

/** The real Biovera position from the production walkthrough. */
const position = (over: Partial<PositionSummary> = {}): PositionSummary => ({
  productId: "prod-1",
  productName: "Biovera",
  imageUrl: "https://cdn.example/product-images/tn/prod-1/image.webp",
  capital: 20000,
  effectiveFrom: "2026-03-01",
  effectiveTo: null,
  status: "active",
  sharePct: 40,
  leads: 3105,
  confirmed: 2,
  uploaded: 0,
  delivered: 1634,
  returned: 422,
  revenue: 66613.498,
  cogs: 15730,
  deliveryCost: 8958,
  returnCost: 1688,
  packingCost: 2056,
  processingCost: 0,
  adSpend: 140,
  netProfit: 38041.498,
  yours: {
    revenue: 26645.399,
    cogs: 6292,
    deliveryCost: 3583.2,
    returnCost: 675.2,
    packingCost: 822.4,
    processingCost: 0,
    adSpend: 56,
    netProfit: 15216.599,
  },
  settledShare: 672.6,
  deliveryRate: 79.5,
  returnRate: 20.5,
  ...over,
});

const card = (over: Partial<PositionSummary> = {}) =>
  render(<PositionCard position={position(over)} market="TN" locale="fr" />);

/**
 * The card used to carry two gauges, a five-row funnel and an eight-row cost
 * breakdown, which made a three-product portfolio an unscannable wall and left
 * no way to ask "why?" about any figure. It is now a summary that opens.
 */
describe("PositionCard — opening the product", () => {
  test("links to the product detail route under the active locale", () => {
    card();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/fr/investor/products/prod-1");
  });

  test("carries the locale rather than assuming French", () => {
    render(<PositionCard position={position()} market="TN" locale="ar" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/ar/investor/products/prod-1");
  });

  test("moves the funnel and the cost breakdown off the card", () => {
    card();
    expect(screen.queryByText(frMessages.investor.funnel.title)).not.toBeInTheDocument();
    expect(screen.queryByText(frMessages.investor.waterfall.title)).not.toBeInTheDocument();
  });
});

describe("PositionCard — product identity", () => {
  test("shows the product photo", () => {
    card();
    const img = screen.getByRole("img", { name: "Biovera" });
    expect(img).toHaveAttribute("src", position().imageUrl!);
  });

  test("falls back to a letter avatar when the product has no photo", () => {
    card({ imageUrl: null });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });
});

/**
 * The card headlined `settledShare` — 672,600 — beside the product's own
 * capital, so the figure an investor read as "what this product made me" was
 * actually a fraction of one settled period. It now leads with their share of
 * the product's whole net profit, and names the percentage it was taken at.
 */
describe("PositionCard — whose money it is", () => {
  test("headlines the investor's share of net profit, not the product's", () => {
    card();
    expect(screen.getByText(money(15216.599))).toBeInTheDocument();
    expect(screen.queryByText(money(38041.498))).not.toBeInTheDocument();
  });

  test("states the share the figure was taken at", () => {
    card();
    expect(screen.getByText(/40% du produit/)).toBeInTheDocument();
  });

  test("does not round a fractional share away", () => {
    card({ sharePct: 33.3333 });
    expect(screen.getByText(/33\.3333% du produit/)).toBeInTheDocument();
  });

  test("renders a losing product in the critical tone, not the profit tone", () => {
    card({ yours: { ...position().yours, netProfit: -1200 } });
    const profit = screen.getByText(money(-1200));
    expect(profit.className).toContain("text-status-critical");
  });

  test("renders a profitable product in the success tone", () => {
    card();
    expect(screen.getByText(money(15216.599)).className).toContain("text-status-success");
  });
});

/**
 * The return gauge was amber at every value, so 2% and 60% looked identical —
 * which is the same as not colouring it at all.
 */
describe("PositionCard — rate thresholds", () => {
  const returnBar = () => {
    const tile = screen
      .getByText(frMessages.investor.positions.returnRate)
      .closest("div")!;
    return within(tile).getByText(/%/).parentElement!.querySelector("span > span")!;
  };

  test("a healthy return rate reads as success", () => {
    card({ returnRate: 8 });
    expect(returnBar().className).toContain("bg-status-success");
  });

  test("a middling return rate reads as a warning", () => {
    card({ returnRate: 20.5 });
    expect(returnBar().className).toContain("bg-status-warning");
  });

  test("a punishing return rate reads as critical", () => {
    card({ returnRate: 41 });
    expect(returnBar().className).toContain("bg-status-critical");
  });

  test("keeps both rate gauges on the card", () => {
    card();
    expect(screen.getByText(frMessages.investor.positions.deliveryRate)).toBeInTheDocument();
    expect(screen.getByText(frMessages.investor.positions.returnRate)).toBeInTheDocument();
  });
});
