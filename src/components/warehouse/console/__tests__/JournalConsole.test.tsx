import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { JournalConsole } from "../JournalConsole";
import type { WarehouseHistoryRow } from "@/lib/warehouse/history-fetch";
import type { HistoryCounts } from "@/app/api/warehouse/history/counts/route";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useLocale: () => "fr",
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
  };
});

let rows: WarehouseHistoryRow[] = [];
let counts: HistoryCounts;
const keys: string[] = [];

vi.mock("swr", () => ({
  default: (key: string | null) => {
    if (key) keys.push(key);
    if (key?.startsWith("/api/warehouse/history/counts")) {
      return { data: counts, error: undefined, isLoading: false };
    }
    if (key?.startsWith("/api/warehouse/stock")) {
      return { data: { rows: [{ product_id: "p1", name: "Coran « Tadabbur wa ʿAmal »" }], warehouses: [] }, error: undefined, isLoading: false };
    }
    return { data: key ? { rows, nextCursor: null } : undefined, error: undefined, isLoading: false };
  },
}));

function row(over: Partial<WarehouseHistoryRow>): WarehouseHistoryRow {
  return {
    kind: "scan",
    id: "r1",
    order_id: "o1",
    order_number: "1042",
    product_id: "p1",
    product_name: "Coran « Tadabbur wa ʿAmal »",
    qty_change: -1,
    balance_after: 943,
    at: "2026-09-29T12:42:00Z",
    detail: "1042 · Coran · Souad",
    is_damaged: false,
    is_reprint: false,
    note: null,
    actor: { id: "u1", full_name: "adel", role: "warehouse_agent", avatar_url: null },
    anomalies: [],
    reason: "scanned",
    warehouse_name: "Benghazi",
    ...over,
  };
}

beforeEach(() => {
  keys.length = 0;
  rows = [
    row({ id: "a" }),
    row({ id: "b", kind: "handover", reason: null, product_id: null, qty_change: null, balance_after: null, warehouse_name: null }),
    row({ id: "c", kind: "count", reason: "stock_count", qty_change: 3, balance_after: 946, anomalies: ["post_scan_adjustment"] }),
  ];
  counts = { all: 230, scan: 225, return: 0, reception: 0, count: 1, adjust: 0, handover: 3, print: 1 };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const lastHistoryKey = () => [...keys].reverse().find((k) => k.startsWith("/api/warehouse/history?"))!;

/**
 * Stock › Mouvements on the desk — `C.journal` of
 * prototypes/entrepot-day-loop-manager-v3.html: « Filtré : » with the
 * product, the family chips WITH their counts, then one table — Quand,
 * Événement, Produit, Qui, Δ → solde. No KPI cards, no search, no CSV.
 */
describe("Mouvements — one product", () => {
  it("asks the server for that product only, rows and counts alike", () => {
    render(<JournalConsole locale="fr" productId="p1" kind="all" onKindChange={vi.fn()} />);
    expect(lastHistoryKey()).toContain("product_id=p1");
    expect(keys.find((k) => k.startsWith("/api/warehouse/history/counts"))).toContain("product_id=p1");
  });

  it("says what it is filtered on, by the product's name, and lets the reader clear it", () => {
    const onClear = vi.fn();
    render(<JournalConsole locale="fr" productId="p1" kind="all" onKindChange={vi.fn()} onClearProduct={onClear} />);
    const chip = screen.getByTestId("wh-journal-product");
    expect(chip).toHaveTextContent("Filtré :");
    expect(chip).toHaveTextContent("Coran « Tadabbur wa ʿAmal »");
    fireEvent.click(within(chip).getByRole("button", { name: "Retirer le filtre" }));
    expect(onClear).toHaveBeenCalled();
  });

  it("names the product even when it has no movement yet", () => {
    rows = [];
    render(<JournalConsole locale="fr" productId="p1" kind="all" onKindChange={vi.fn()} />);
    expect(screen.getByTestId("wh-journal-product")).toHaveTextContent("Coran « Tadabbur wa ʿAmal »");
  });

  it("asks for every product when none is given", () => {
    render(<JournalConsole locale="fr" kind="all" onKindChange={vi.fn()} />);
    expect(lastHistoryKey()).not.toContain("product_id");
    expect(screen.queryByTestId("wh-journal-product")).toBeNull();
  });
});

describe("Mouvements — families", () => {
  const chips = () => screen.getAllByTestId(/^wh-filter-/);

  it("shows each family with its count, empty families included", () => {
    render(<JournalConsole locale="fr" productId="p1" kind="all" onKindChange={vi.fn()} />);
    expect(chips().map((c) => c.textContent)).toEqual([
      "Tout230", "Sorties225", "Retours0", "Réceptions0", "Inventaires1", "Ajustements0",
    ]);
  });

  it("adds the handovers and the label prints when no product narrows the view", () => {
    // Neither has a product: filtered on one, they have no source at all.
    render(<JournalConsole locale="fr" kind="all" onKindChange={vi.fn()} />);
    expect(chips().map((c) => c.dataset.testid)).toEqual([
      "wh-filter-all", "wh-filter-scan", "wh-filter-return", "wh-filter-reception",
      "wh-filter-count", "wh-filter-adjust", "wh-filter-handover", "wh-filter-print",
    ]);
  });

  it("asks the server for the chosen family rather than filtering the page", () => {
    const onKind = vi.fn();
    const { rerender } = render(<JournalConsole locale="fr" kind="all" onKindChange={onKind} />);
    fireEvent.click(screen.getByTestId("wh-filter-scan"));
    expect(onKind).toHaveBeenCalledWith("scan");
    rerender(<JournalConsole locale="fr" kind="scan" onKindChange={onKind} />);
    expect(lastHistoryKey()).toContain("kind=scan");
    expect(screen.getByTestId("wh-filter-scan")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("wh-filter-all")).toHaveAttribute("aria-pressed", "false");
  });
});

describe("Mouvements — the table", () => {
  it("has the prototype's five columns", () => {
    render(<JournalConsole locale="fr" kind="all" onKindChange={vi.fn()} />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Quand", "Événement", "Produit", "Qui", "Δ → solde",
    ]);
  });

  it("reads a scan as the prototype row does", () => {
    render(<JournalConsole locale="fr" kind="all" onKindChange={vi.fn()} />);
    const cells = within(screen.getByTestId("wh-row-a")).getAllByRole("cell").map((c) => c.textContent);
    expect(cells[0]).toMatch(/^29 sept\. · \d\d:42$/);
    expect(cells[1]).toBe("Sortie scannée");
    expect(cells[2]).toBe("Coran « Tadabbur wa ʿAmal »");
    expect(cells[3]).toBe("adel · Benghazi");
    expect(cells[4]).toBe("−1 → 943");
  });

  it("names the event by its ledger reason", () => {
    render(<JournalConsole locale="fr" kind="all" onKindChange={vi.fn()} />);
    expect(within(screen.getByTestId("wh-row-c")).getAllByRole("cell")[1]).toHaveTextContent("Comptage");
    expect(within(screen.getByTestId("wh-row-c")).getAllByRole("cell")[4]).toHaveTextContent("+3 → 946");
    expect(within(screen.getByTestId("wh-row-b")).getAllByRole("cell")[1]).toHaveTextContent("Remise au transporteur");
  });

  it("draws a dash for a handover, which moves no stock", () => {
    render(<JournalConsole locale="fr" kind="all" onKindChange={vi.fn()} />);
    expect(within(screen.getByTestId("wh-row-b")).getAllByRole("cell")[4]).toHaveTextContent("—");
  });

  it("carries no KPI card, no search, no CSV export", () => {
    render(<JournalConsole locale="fr" kind="all" onKindChange={vi.fn()} />);
    expect(screen.queryByTestId(/^wh-kpi-/)).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/CSV/)).toBeNull();
  });

  it("styles through tokens, never raw hex", () => {
    const { container } = render(<JournalConsole locale="fr" productId="p1" kind="all" onKindChange={vi.fn()} />);
    const classes = Array.from(container.querySelectorAll<HTMLElement>("*"))
      .map((el) => el.className)
      .filter((c): c is string => typeof c === "string")
      .join(" ");
    expect(classes).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
