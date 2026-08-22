import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
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

/** Libya as it actually reads in production: a deep uploaded backlog, no scans yet. */
const summary: WarehouseSummary = {
  kpis: {
    pendingLabels: kpi(0, 0),
    toScanOut: kpi(0, 0),
    returnsInbox: kpi(6, 7),
    damagedThisWeek: kpi(0, 0),
  },
  queue: {
    toPrepare: 17,
    oldestPrepareHours: 96,
    latePrepare: 5,
    neverScanned: 427,
    confirmedNotUploaded: 10,
    carrierWarehouse: 36,
    returnsInbox: 6,
    toHandOver: 14,
  },
  day: {
    scannedToday: 11,
    scannedYesterday: 8,
    handedToday: 14,
    handedYesterday: 12,
    returnsToday: 6,
    returnsYesterday: 7,
  },
  leaderboard: [
    { actorId: "u1", name: "Salima", scanned: 38, activeHours: 8, ratePerHour: 4.8 },
    { actorId: "u2", name: "Hend", scanned: 26, activeHours: 7.9, ratePerHour: 3.3 },
  ],
  trend: [{ day: "2026-08-18", scanned: 11, returned: 2, damaged: 0 }],
  activity: [],
  lowStock: [],
  selectedMarket: { id: "m1", name: "Libye", code: "ly", currency: "LYD" },
  availableMarkets: [],
  scope: "single",
} as unknown as WarehouseSummary;

const quiet = {
  ...summary,
  queue: {
    toPrepare: 0, oldestPrepareHours: 0, latePrepare: 0, neverScanned: 0,
    confirmedNotUploaded: 0, carrierWarehouse: 0, returnsInbox: 0, toHandOver: 0,
  },
  day: {
    scannedToday: 0, scannedYesterday: 0, handedToday: 0,
    handedYesterday: 0, returnsToday: 0, returnsYesterday: 0,
  },
  leaderboard: [],
} as unknown as WarehouseSummary;

describe("Aujourd'hui — the pipeline strip", () => {
  it("shows the prototype's five cells, in order", () => {
    render(<TodayOverview summary={summary} locale="fr" />);
    const cells = screen.getAllByTestId(/^wh-cell-/);
    expect(cells.map((c) => c.dataset.testid ?? c.getAttribute("data-testid"))).toEqual([
      "wh-cell-prepare",
      "wh-cell-scanned",
      "wh-cell-handed",
      "wh-cell-returns",
      "wh-cell-lowStock",
    ]);
  });

  it("reads À préparer from the uploaded queue, not from confirmed orders", () => {
    render(<TodayOverview summary={summary} locale="fr" />);
    const cell = screen.getByTestId("wh-cell-prepare");
    expect(within(cell).getByText("17")).toBeInTheDocument();
    // 96 h on the bench is four days, and the operator is told so.
    expect(within(cell).getByText(/4 j/)).toBeInTheDocument();
  });

  it("shows today's scans and handovers, which come from order_history", () => {
    render(<TodayOverview summary={summary} locale="fr" />);
    expect(within(screen.getByTestId("wh-cell-scanned")).getByText("11")).toBeInTheDocument();
    expect(within(screen.getByTestId("wh-cell-handed")).getByText("14")).toBeInTheDocument();
  });

  it("dims the cell that has nothing to say instead of decorating it", () => {
    render(<TodayOverview summary={summary} locale="fr" />);
    // No low stock: the fifth cell steps back rather than competing.
    expect(screen.getByTestId("wh-cell-lowStock").dataset.dim).toBe("true");
    expect(screen.getByTestId("wh-cell-prepare").dataset.dim).toBe("false");
  });

  it("sets every figure in the mono face the prototype uses", () => {
    render(<TodayOverview summary={summary} locale="fr" />);
    for (const id of ["prepare", "scanned", "handed", "returns", "lowStock"]) {
      const value = within(screen.getByTestId(`wh-cell-${id}`)).getByTestId("wh-value");
      expect(value.className).toMatch(/font-mono/);
    }
  });
});

describe("Aujourd'hui — priority actions", () => {
  it("raises the four actions the prototype names, largest first", () => {
    render(<TodayOverview summary={summary} locale="fr" />);
    const rows = screen.getAllByTestId(/^wh-action-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "wh-action-neverScanned",
      "wh-action-carrierWarehouse",
      "wh-action-confirmed",
      "wh-action-late",
    ]);
  });

  it("totals what there is to catch up on", () => {
    render(<TodayOverview summary={summary} locale="fr" />);
    // 427 + 36 + 10 + 5
    expect(screen.getByTestId("wh-actions-total")).toHaveTextContent("478");
  });

  it("stripes only the heaviest row, so the stripe still means something", () => {
    render(<TodayOverview summary={summary} locale="fr" />);
    const rows = screen.getAllByTestId(/^wh-action-/);
    expect(rows.filter((r) => r.dataset.stripe === "true")).toHaveLength(1);
    expect(rows[0].dataset.stripe).toBe("true");
  });

  it("says so plainly when there is nothing to act on", () => {
    render(<TodayOverview summary={quiet} locale="fr" />);
    expect(screen.getByTestId("wh-actions-empty")).toBeInTheDocument();
  });
});

describe("Aujourd'hui — Classement", () => {
  it("ranks operators by scans per hour present", () => {
    render(<TodayOverview summary={summary} locale="fr" />);
    const rows = screen.getAllByTestId(/^wh-rank-/);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Salima")).toBeInTheDocument();
    expect(within(rows[0]).getByText(/4,8/)).toBeInTheDocument();
  });

  it("shows each operator's gap to the one above, not to the leader", () => {
    render(<TodayOverview summary={summary} locale="fr" />);
    const second = screen.getByTestId("wh-rank-u2");
    expect(within(second).getByTestId("wh-gap")).toHaveTextContent(/Salima/);
    // The leader has nobody above them.
    expect(within(screen.getByTestId("wh-rank-u1")).queryByTestId("wh-gap")).toBeNull();
  });

  it("stays silent rather than showing an empty podium", () => {
    render(<TodayOverview summary={quiet} locale="fr" />);
    expect(screen.getByTestId("wh-ranking-empty")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^wh-rank-/)).toHaveLength(0);
  });
});

describe("Aujourd'hui — vs hier", () => {
  it("compares against yesterday's real figures", () => {
    render(<TodayOverview summary={summary} locale="fr" />);
    // 11 vs 8 = +37 %, and up is good for scans.
    const scanned = screen.getByTestId("wh-vs-scanned");
    expect(scanned.dataset.direction).toBe("up");
    expect(scanned).toHaveTextContent("11");
    // 6 vs 7 returns processed = down.
    expect(screen.getByTestId("wh-vs-returns").dataset.direction).toBe("down");
  });

  it("draws a dash, never a percentage, when yesterday was zero", () => {
    render(<TodayOverview summary={quiet} locale="fr" />);
    const scanned = screen.getByTestId("wh-vs-scanned");
    expect(scanned.dataset.direction).toBe("flat");
    expect(scanned).not.toHaveTextContent("%");
  });
});

describe("Aujourd'hui — house rules", () => {
  it("styles through tokens, never raw hex", () => {
    const { container } = render(<TodayOverview summary={summary} locale="fr" />);
    const classes = Array.from(container.querySelectorAll<HTMLElement>("*"))
      .map((el) => el.className)
      .filter((c): c is string => typeof c === "string")
      .join(" ");
    expect(classes).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("makes an action clickable once it has somewhere to go", () => {
    const go = vi.fn();
    render(<TodayOverview summary={summary} locale="fr" onOpenPreparation={go} />);
    screen.getByTestId("wh-action-late").click();
    expect(go).toHaveBeenCalledOnce();
  });
});
