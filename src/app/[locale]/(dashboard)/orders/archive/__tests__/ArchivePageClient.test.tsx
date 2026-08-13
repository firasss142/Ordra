import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import frMessages from "@/messages/fr.json";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const resolve = (key: string, params?: Record<string, unknown>) => {
      const parts = namespace ? `${namespace}.${key}`.split(".") : key.split(".");
      let val: unknown = frMessages;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      if (typeof val !== "string") return key;
      if (params)
        return Object.entries(params).reduce(
          (s, [k, v]) => s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v)),
          val,
        );
      return val;
    };
    return resolve;
  },
}));

vi.mock("@/context/market-scope", () => ({
  useMarketScope: () => ({ scope: "ly", marketId: "m-ly" }),
}));

vi.mock("@/hooks/useOrdersRealtime", () => ({ useOrdersRealtime: () => {} }));

const mutateList = vi.fn();
let listRows: unknown[] = [];
vi.mock("@/hooks/useOrdersList", () => ({
  useOrdersList: () => ({
    rows: listRows,
    total: listRows.length,
    isLoading: false,
    hasNext: false,
    hasPrev: false,
    nextPage: vi.fn(),
    prevPage: vi.fn(),
    currentPage: 1,
    mutate: mutateList,
  }),
}));

const mutateSummary = vi.fn();
let summary: unknown = null;
vi.mock("swr", () => ({
  default: () => ({ data: summary ? { data: summary } : undefined, isLoading: false, mutate: mutateSummary }),
}));

import { ArchivePageClient } from "../ArchivePageClient";

const SUMMARY = {
  total: 2053,
  shipped: 445,
  outcomes: { delivered: 351, returned: 94, rejected: 1379, cancelled: 229 },
  reasons: { injoignable: 403, refus_client: 432, autre: 238, commande_invalide: 303, livraison_impossible: 3 },
  winback: { total: 403, never_called: 135, partial: 101, exhausted: 167, second_phone: 0 },
  cities: [
    { city: "بنغازي", shipped: 105, returned: 34 },
    { city: "طبرق", shipped: 22, returned: 3 },
  ],
  speed: [{ status: "rejected", n: 1387, median_days: 1, p90_days: 6.7, same_day: 704 }],
  cohorts: [],
  placement: { archived: 1734, in_list: 316 },
};

function row(over: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    external_id: "LY-1",
    market_id: "m-ly",
    customer_name: "Client",
    customer_city: "بنغازي",
    product_name: "P",
    status: "rejected",
    rejection_reason: "injoignable",
    total_price: 100,
    terminal_at: "2026-06-01T00:00:00Z",
    archived_at: null,
    ...over,
  };
}

function renderPage() {
  return render(
    <ArchivePageClient
      role="market_manager"
      locale="fr"
      userMarketId="m-ly"
      userMarketLabel="Libye"
      userMarketCurrency="LYD"
      initialMarketId="m-ly"
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  summary = SUMMARY;
  listRows = [row()];
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { archived: 1, skipped: [] } }),
  }) as unknown as typeof fetch;
});

describe("ArchivePageClient", () => {
  /**
   * The defect the whole rebuild is about: the old page counted `total` over a
   * different set than the tiles, so the percentages could not sum to 100%.
   */
  it("shows four outcomes that add up to the total", () => {
    renderPage();
    const o = SUMMARY.outcomes;
    expect(o.delivered + o.returned + o.rejected + o.cancelled).toBe(SUMMARY.total);

    const split = within(
      screen.getByRole("region", { name: frMessages.orders.archive.resultTitle }),
    );
    expect(split.getByText("351")).toBeInTheDocument();
    expect(split.getByText("1 379")).toBeInTheDocument();
    expect(split.getByText("229")).toBeInTheDocument();
    expect(split.getByText("94")).toBeInTheDocument();
  });

  it("leads with how many orders succeeded", () => {
    renderPage();
    // 351 / 2053 = 17.1%
    const hero = within(
      screen.getByRole("region", { name: frMessages.orders.archive.resultSucceeded }),
    );
    expect(hero.getByText("17,1 %")).toBeInTheDocument();
  });

  it("calls out the orders nobody ever phoned", () => {
    renderPage();
    const win = within(
      screen.getByRole("region", { name: frMessages.orders.archive.winbackTitle }),
    );
    expect(win.getByText("135")).toBeInTheDocument();
    expect(
      win.getByText(frMessages.orders.archive.winbackNeverCalled),
    ).toBeInTheDocument();
  });

  it("hides a return rate computed on too few parcels", () => {
    renderPage();
    // Benghazi has 105 shipped and keeps its rate; Tobruk has 22 and loses it.
    expect(screen.getByText("32,4 %")).toBeInTheDocument();
    expect(screen.queryByText("13,6 %")).not.toBeInTheDocument();
    expect(screen.getByText(frMessages.orders.archive.tooFew)).toBeInTheDocument();
  });

  it("switches the register between where orders sit", () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: frMessages.orders.archive.tabArchived }));
    expect(
      screen.getByRole("tab", { name: frMessages.orders.archive.tabArchived }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("puts the selected orders away and refreshes both halves of the page", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("checkbox", { name: /11111111/ }));
    fireEvent.click(screen.getByRole("button", { name: frMessages.orders.archive.putAway }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/orders/archive");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      order_ids: ["11111111-1111-4111-8111-111111111111"],
      action: "archive",
    });

    // Tiles and rows must refresh together or the page contradicts itself.
    await waitFor(() => {
      expect(mutateList).toHaveBeenCalled();
      expect(mutateSummary).toHaveBeenCalled();
    });
  });

  it("offers to bring an order back when looking at what was put away", () => {
    listRows = [row({ archived_at: "2026-07-01T00:00:00Z" })];
    renderPage();

    fireEvent.click(screen.getByRole("tab", { name: frMessages.orders.archive.tabArchived }));
    fireEvent.click(screen.getByRole("checkbox", { name: /11111111/ }));

    expect(
      screen.getByRole("button", { name: frMessages.orders.archive.bringBack }),
    ).toBeInTheDocument();
  });

  /**
   * Losses were rendered from a hard-coded list of reasons. Anything the
   * database returned that was not on that list — `autre`, 238 orders — simply
   * did not appear, so the rows added up to less than the "orders lost" figure
   * printed above them. The list is now built from the data.
   */
  it("accounts for every lost order, including reasons it has no styling for", () => {
    renderPage();

    const causes = within(
      screen.getByRole("region", { name: frMessages.orders.archive.causesTitle }),
    );
    const shown = causes
      .getAllByRole("listitem")
      .map((li) => Number(li.getAttribute("data-count")));
    const lost = SUMMARY.total - SUMMARY.outcomes.delivered;

    expect(shown.reduce((a, b) => a + b, 0)).toBe(lost);
    // 'autre' has no bespoke entry and must still be listed.
    expect(causes.getByText(frMessages.orders.rejectionReasons.autre)).toBeInTheDocument();
  });

  it("names outcomes in French, never the raw database value", () => {
    renderPage();
    const split = within(
      screen.getByRole("region", { name: frMessages.orders.archive.resultTitle }),
    );
    expect(split.getByText(frMessages.orders.statuses.delivered)).toBeInTheDocument();
    expect(split.queryByText("delivered")).not.toBeInTheDocument();
    expect(split.queryByText("status_delivered")).not.toBeInTheDocument();
  });

  it("renders no dead checkboxes — every one selects a row", () => {
    renderPage();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(box).toBeEnabled();
  });
});
