import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { JournalConsole } from "../JournalConsole";
import type { WarehouseHistoryRow } from "@/lib/warehouse/history-fetch";

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

let rows: WarehouseHistoryRow[] = [];
const mutate = vi.fn();
let lastKey = "";

vi.mock("swr", () => ({
  default: (key: string) => {
    lastKey = key;
    return { data: { rows, nextCursor: null }, error: undefined, isLoading: false, mutate };
  },
}));

const at = (iso: string) => new Date(iso).toISOString();

function row(over: Partial<WarehouseHistoryRow>): WarehouseHistoryRow {
  return {
    kind: "scan",
    id: "r1",
    order_id: "o1",
    order_number: "1042",
    product_id: "p1",
    product_name: "دمية ملاكمة",
    qty_change: -1,
    balance_after: 200,
    at: at(new Date().toISOString()),
    detail: "#1042 · دمية ملاكمة · Salima",
    is_damaged: false,
    is_reprint: false,
    note: null,
    actor: { id: "u1", full_name: "Salima", role: "warehouse_agent", avatar_url: null },
    anomalies: [],
    ...over,
  };
}

beforeEach(() => {
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  rows = [
    row({ id: "a", kind: "scan", at: today.toISOString() }),
    row({ id: "b", kind: "handover", at: today.toISOString(), qty_change: null, balance_after: null }),
    row({
      id: "c", kind: "adjust", at: yesterday.toISOString(),
      qty_change: -2, balance_after: 216, anomalies: ["post_scan_adjustment"],
    }),
  ];
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

const setup = () => render(<JournalConsole locale="fr" />);

describe("Journal — the ledger", () => {
  it("groups rows under a day band that counts its own day", () => {
    setup();
    const bands = screen.getAllByTestId(/^wh-day-/);
    expect(bands).toHaveLength(2);
    expect(within(bands[0]).getByText(/Aujourd'hui/)).toBeInTheDocument();
    expect(within(bands[0]).getByText("2")).toBeInTheDocument();
  });

  it("shows a delta and a resulting balance for stock movements", () => {
    setup();
    const scan = screen.getByTestId("wh-row-a");
    expect(within(scan).getByTestId("wh-delta")).toHaveTextContent("-1");
    expect(within(scan).getByTestId("wh-delta")).toHaveTextContent("200");
  });

  it("draws a dash for a handover, which moves no stock", () => {
    setup();
    // The units left the shelf at scan-out; a handover is a status change.
    expect(within(screen.getByTestId("wh-row-b")).getByTestId("wh-delta")).toHaveTextContent("—");
  });

  it("marks an anomaly on the row itself, not only in a counter", () => {
    setup();
    const anomalous = screen.getByTestId("wh-row-c");
    expect(anomalous.dataset.anomaly).toBe("true");
    expect(within(anomalous).getByText(/à justifier/)).toBeInTheDocument();
  });
});

describe("Journal — filters", () => {
  it("offers only the six categories that have a source", () => {
    setup();
    const pills = screen.getAllByTestId(/^wh-filter-/);
    expect(pills.map((p) => p.getAttribute("data-testid"))).toEqual([
      "wh-filter-all",
      "wh-filter-scan",
      "wh-filter-handover",
      "wh-filter-return",
      "wh-filter-adjust",
      "wh-filter-print",
    ]);
  });

  it("asks the server for the chosen category rather than filtering the page", () => {
    setup();
    fireEvent.click(screen.getByTestId("wh-filter-handover"));
    // Filtering client-side would silently hide rows that live on later pages.
    expect(lastKey).toContain("kind=handover");
  });

  it("marks the active pill for assistive tech, not just visually", () => {
    setup();
    expect(screen.getByTestId("wh-filter-all")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("wh-filter-scan"));
    expect(screen.getByTestId("wh-filter-scan")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("wh-filter-all")).toHaveAttribute("aria-pressed", "false");
  });
});

describe("Journal — counters", () => {
  it("counts today's events, and says how many are stock movements", () => {
    setup();
    const card = screen.getByTestId("wh-kpi-events");
    expect(within(card).getByTestId("wh-value")).toHaveTextContent("2");
  });

  it("reports traceability from rows that actually carry an author", () => {
    rows = [...rows, row({ id: "d", actor: null })];
    setup();
    const card = screen.getByTestId("wh-kpi-trace");
    // Three of four rows have an author.
    expect(within(card).getByTestId("wh-value")).toHaveTextContent("75");
  });
});

describe("Journal — house rules", () => {
  it("styles through tokens, never raw hex", () => {
    const { container } = setup();
    const classes = Array.from(container.querySelectorAll<HTMLElement>("*"))
      .map((el) => el.className)
      .filter((c): c is string => typeof c === "string")
      .join(" ");
    expect(classes).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
