import { describe, test, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import frMessages from "@/messages/fr.json";
import { PositionDetailClient } from "./PositionDetailClient";
import type { PortfolioResult, PositionSummary } from "@/lib/investors/portfolio";

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

// The component shares the overview's SWR key; the fallbackData path is what
// actually renders, so returning it directly mirrors production.
vi.mock("swr", () => ({
  default: (_key: string, config: { fallbackData?: unknown }) => ({
    data: config?.fallbackData,
    error: undefined,
  }),
}));

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

const portfolio = (positions: PositionSummary[]): PortfolioResult =>
  ({
    investor: { id: "inv-1", legalName: "Ilyes Capital SARL", reservePct: 10 },
    marketId: "m-tn",
    marketCode: "TN",
    currency: "TND",
    balance: {
      pending: 0,
      reserve: 67.26,
      available: 605.34,
      withdrawn: 0,
      lifetimeProfit: 672.6,
      principalReturned: 0,
    },
    totalInvested: 20000,
    lifetimeShare: 672.6,
    positions,
    unsettledEstimate: 14543.999,
    lastSettledPeriodEnd: "2026-03-31",
    claimedByOpenRequests: 0,
    reserveReleaseAfter: "2026-06-29",
  }) as PortfolioResult;

const detail = (over: Partial<PositionSummary> = {}, productId = "prod-1") =>
  render(
    <PositionDetailClient
      initialData={portfolio([position(over)])}
      productId={productId}
      locale="fr"
    />
  );

const row = (label: string) => screen.getByText(label).closest("[data-waterfall-row]")!;

/**
 * The portfolio showed the product's full 38 041,498 net profit beside a
 * settled share of 672,600 with nothing connecting them, so the investor was
 * left to guess whether they were owed one, the other, or neither. Putting the
 * share on every line makes the arithmetic visible rather than inferred:
 * 672,600 settled + 14 543,999 pending = 15 216,599 = exactly 40% of 38 041,498.
 */
describe("PositionDetailClient — two-column waterfall", () => {
  test("labels both columns, naming the share percentage", () => {
    detail();
    expect(screen.getByText("Produit (100%)")).toBeInTheDocument();
    expect(screen.getByText("Vous (40%)")).toBeInTheDocument();
  });

  test("shows the product figure and the investor's share on the same row", () => {
    detail();
    const r = row(frMessages.investor.waterfall.revenue);
    expect(r).toHaveTextContent("66 613,498");
    expect(r).toHaveTextContent("26 645,399");
  });

  test("the share column reconciles to the share of net profit", () => {
    detail();
    const r = row(frMessages.investor.waterfall.netProfit);
    expect(r).toHaveTextContent("38 041,498");
    expect(r).toHaveTextContent("15 216,599");
  });

  test("costs render as negative in both columns", () => {
    detail();
    const r = row(frMessages.investor.waterfall.cogs);
    expect(r).toHaveTextContent("−15 730,000");
    expect(r).toHaveTextContent("−6 292,000");
  });

  test("a zero cost is not rendered as negative zero", () => {
    detail();
    expect(row(frMessages.investor.waterfall.processing)).not.toHaveTextContent("−0,000");
  });

  test("shows a fractional share percentage without rounding it away", () => {
    detail({ sharePct: 33.3333 });
    expect(screen.getByText("Vous (33.3333%)")).toBeInTheDocument();
  });

  test("the investor's bottom line is the loudest figure in the block", () => {
    detail();
    const mine = screen.getByText("15 216,599 DT");
    expect(mine.className).toContain("text-[18px]");
    expect(mine.className).toContain("text-status-success");
  });

  test("a losing position renders its bottom line as critical", () => {
    detail({ yours: { ...position().yours, netProfit: -900 } });
    expect(screen.getByText("-900,000 DT").className).toContain("text-status-critical");
  });
});

/**
 * effectiveFrom, effectiveTo and status were all fetched and all discarded, so
 * a closed position simply vanished from the portfolio with no explanation.
 */
describe("PositionDetailClient — position identity", () => {
  test("shows the product photo at hero size", () => {
    detail();
    expect(screen.getByRole("img", { name: "Biovera" })).toBeInTheDocument();
  });

  test("says when an open position started", () => {
    detail();
    expect(screen.getByText(/Depuis le/)).toBeInTheDocument();
    expect(screen.getByText(frMessages.investor.positions.active)).toBeInTheDocument();
  });

  test("says when a closed position ended, instead of hiding it", () => {
    detail({ effectiveTo: "2026-06-30", status: "closed" });
    expect(screen.getByText(/Clôturée le/)).toBeInTheDocument();
    expect(screen.getByText(frMessages.investor.positions.closed)).toBeInTheDocument();
  });

  test("explains that the share is pro-rated by days", () => {
    detail();
    expect(screen.getByText(/prorata des jours/i)).toBeInTheDocument();
  });
});

/**
 * Returns are not a stage orders pass through, they are the leak at the end.
 * Drawn as one more grey bar in a descending list, a returns spike looked like
 * normal attrition.
 */
describe("PositionDetailClient — funnel", () => {
  test("keeps the four funnel stages", () => {
    detail();
    const funnel = screen.getByText(frMessages.investor.funnel.title).closest("section")!;
    for (const label of ["leads", "confirmed", "uploaded", "delivered"] as const) {
      expect(within(funnel).getByText(frMessages.investor.funnel[label])).toBeInTheDocument();
    }
  });

  test("draws returns as a leak in the warning tone, not another funnel bar", () => {
    detail();
    const returns = screen.getByText(frMessages.investor.funnel.returned).parentElement!;
    expect(returns.querySelector(".bg-status-warning")).not.toBeNull();
    expect(returns).toHaveTextContent("422");
  });

  test("gives the return count something to be a share of", () => {
    detail();
    expect(screen.getByText(/sur 1 634 livrées/)).toBeInTheDocument();
  });
});

describe("PositionDetailClient — a product the investor does not hold", () => {
  test("offers a way back rather than a blank screen", () => {
    detail({}, "prod-not-mine");
    expect(screen.getByText(frMessages.investor.detail.notFound)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: frMessages.investor.detail.back })).toHaveAttribute(
      "href",
      "/fr/investor"
    );
  });
});
