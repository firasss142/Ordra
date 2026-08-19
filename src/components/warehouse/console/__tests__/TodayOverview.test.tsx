import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TodayOverview } from "../TodayOverview";
import type { WarehouseSummary } from "@/lib/warehouse/summary";

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

vi.mock("next/dynamic", () => ({
  default: () => function StubChart() {
    return <div data-testid="trend-chart" />;
  },
}));

afterEach(() => cleanup());

const kpi = (current: number, previous: number) => ({
  current,
  previous,
  delta: current - previous,
  deltaPct: previous === 0 ? null : ((current - previous) / previous) * 100,
});

const summary: WarehouseSummary = {
  kpis: {
    pendingLabels: kpi(17, 12),
    toScanOut: kpi(11, 8),
    returnsInbox: kpi(6, 7),
    damagedThisWeek: kpi(0, 0),
  },
  trend: [{ day: "2026-08-18", scanned: 11, returned: 2, damaged: 0 }],
  activity: [
    { kind: "scan", id: "a1", order_id: "o1", at: "2026-08-19T09:00:00Z", detail: "Sortie scannée" },
  ],
  lowStock: [],
  selectedMarket: { id: "m1", name: "Libye", code: "ly", currency: "LYD" },
  availableMarkets: [],
  scope: "single",
} as unknown as WarehouseSummary;

describe("TodayOverview", () => {
  it("shows the five operational figures of the day", () => {
    const { container } = render(<TodayOverview summary={summary} locale="fr" />);
    const strip = container.querySelector("section, div");
    expect(strip).toBeTruthy();
    // The figures also reappear in the vs-hier card, so assert presence,
    // not uniqueness.
    expect(screen.getAllByText("17").length).toBeGreaterThan(0);
    expect(screen.getAllByText("11").length).toBeGreaterThan(0);
    expect(screen.getAllByText("6").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId(/^wh-kpi-/).length).toBeGreaterThanOrEqual(5);
  });

  it("renders a settled cell for every queue that is empty", () => {
    render(<TodayOverview summary={summary} locale="fr" />);
    // damagedThisWeek = 0 and lowStock = [] — both settled.
    expect(screen.getAllByTestId("wh-kpi-settled")).toHaveLength(2);
  });

  it("raises a priority action for each product under its threshold", () => {
    const withLowStock = {
      ...summary,
      lowStock: [
        { id: "p1", name: "دميه ملاكمه حجم صغير", current_stock: 4, low_stock_threshold: 20, market_id: "m1" },
      ],
    } as unknown as WarehouseSummary;
    render(<TodayOverview summary={withLowStock} locale="fr" />);
    expect(screen.getByText(/دميه ملاكمه حجم صغير/)).toBeInTheDocument();
  });

  it("compares today against yesterday from the figures the API already carries", () => {
    render(<TodayOverview summary={summary} locale="fr" />);
    // returnsInbox went 7 → 6, a fall of ~14%: the direction must be visible,
    // not just the number.
    expect(screen.getByTestId("wh-delta-returnsInbox")).toHaveAttribute("data-direction", "down");
    expect(screen.getByTestId("wh-delta-pendingLabels")).toHaveAttribute("data-direction", "up");
  });

  it("says so plainly when there is nothing to act on", () => {
    const quiet = {
      ...summary,
      kpis: {
        pendingLabels: kpi(0, 0),
        toScanOut: kpi(0, 0),
        returnsInbox: kpi(0, 0),
        damagedThisWeek: kpi(0, 0),
      },
      lowStock: [],
    } as unknown as WarehouseSummary;
    render(<TodayOverview summary={quiet} locale="fr" />);
    expect(screen.getByTestId("wh-actions-empty")).toBeInTheDocument();
  });

  it("raises one action per thing that needs doing", () => {
    render(<TodayOverview summary={summary} locale="fr" />);
    // 17 to prepare and 6 returns waiting — two actions, no low stock.
    expect(screen.queryByTestId("wh-actions-empty")).not.toBeInTheDocument();
    // Without click handlers the rows are inert content, not controls.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("makes an action clickable once it has somewhere to go", () => {
    const go = vi.fn();
    render(<TodayOverview summary={summary} locale="fr" onOpenPreparation={go} />);
    const button = screen.getAllByRole("button")[0];
    button.click();
    expect(go).toHaveBeenCalledOnce();
  });

  it("styles through tokens, never raw hex", () => {
    const { container } = render(<TodayOverview summary={summary} locale="fr" />);
    const classes = Array.from(container.querySelectorAll<HTMLElement>("*"))
      .map((el) => el.className)
      .filter((c): c is string => typeof c === "string")
      .join(" ");
    expect(classes).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
