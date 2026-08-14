import React from "react";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import frMessages from "@/messages/fr.json";
import type {
  ProductListRow,
  ProductPeriodMetrics,
  ProductFacetCounts,
} from "@/types/product-list";
import { ProductsRowList } from "../ProductsRowList";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

/** Same local FR table as ProductRow.test — merged into fr.json by the i18n agent. */
const ROW_LIST_FR = {
  summary: "{count} produit(s) · {active} actif(s)",
  density: "Densité",
  densityComfortable: "Confortable",
  densityCompact: "Compact",
  sortBy: "Trier : {value}",
  sortAscending: "Croissant",
  sortDescending: "Décroissant",
  sortKeys: {
    name: "Nom",
    currentStock: "Stock",
    unitCogs: "COGS unitaire",
    revenue: "Chiffre d'affaires",
    netProfit: "Profit net",
    marginPct: "Marge nette",
    confirmationRate: "Taux de confirmation",
    deliveryRate: "Taux de livraison",
    returnRate: "Taux de retour",
    totalLeads: "Commandes reçues",
    isActive: "Statut",
  },
  orders: "Commandes",
  ordersCaption: "reçues",
  confirmed: "Confirmées",
  delivered: "Livrées",
  noDispatch: "aucun upload",
  marginValue: "Marge {value}",
  noRevenueYet: "Coûts engagés, rien d'encaissé",
  stockCount: "{count} en stock",
  stockThreshold: "seuil {count}",
  inFlight: "{count} en cours",
  inFlightHint: "Uploadées, en attente d'un statut transporteur",
  noOrders: "Aucune commande sur ce produit",
  metricsUnavailable: "Chiffres indisponibles",
  openProduct: "Ouvrir la fiche de {name}",
};

const messages = {
  ...frMessages,
  products: { ...frMessages.products, rowList: ROW_LIST_FR },
};

function makeMetrics(over: Partial<ProductPeriodMetrics> = {}): ProductPeriodMetrics {
  return {
    total_leads: 200,
    confirmed_count: 120,
    dispatched_count: 100,
    delivered_count: 50,
    returned_count: 10,
    confirmation_rate: 60,
    delivery_rate: 50,
    return_rate: 10,
    revenue: 5000,
    net_profit: 1200,
    margin_pct: 24,
    cost_per_delivered: 20,
    cogs: 500,
    delivery_cost: 300,
    return_cost: 100,
    packing_cost: 120,
    processing_cost: 60,
    ad_spend: 400,
    ...over,
  };
}

function makeRow(id: string, over: Partial<ProductListRow> = {}): ProductListRow {
  return {
    id,
    market_id: "m1",
    name: `Produit ${id}`,
    sku: null,
    image_url: null,
    unit_cogs: 10,
    packing_cost: 1,
    confirmation_processing_cost: 0.5,
    default_price: 50,
    initial_stock: 100,
    current_stock: 40,
    system_inventory: 40,
    real_inventory: 40,
    low_stock_threshold: 10,
    damaged_return_count: 0,
    is_active: true,
    variant_count: 0,
    metrics: makeMetrics(),
    ...over,
  };
}

const FACETS: ProductFacetCounts = {
  all: 8,
  active: 5,
  inactive: 3,
  outOfStock: 2,
  lowStock: 0,
  losingMoney: 2,
  thinMargin: 1,
  noSales: 3,
};

type ListProps = React.ComponentProps<typeof ProductsRowList>;

function renderList(over: Partial<ListProps> = {}) {
  const props: ListProps = {
    rows: [makeRow("p1"), makeRow("p2")],
    facets: FACETS,
    facet: "all",
    onFacetChange: vi.fn(),
    search: "",
    onSearchChange: vi.fn(),
    sort: "name",
    dir: "asc",
    onSortChange: vi.fn(),
    selectedIds: new Set<string>(),
    onToggleSelect: vi.fn(),
    onToggleSelectAll: vi.fn(),
    onToggleActive: vi.fn(),
    onAdjustStock: vi.fn(),
    onArchive: vi.fn(),
    canManage: true,
    canToggleActive: true,
    canArchive: true,
    locale: "fr",
    currency: "LYD",
    loading: false,
    periodLabel: "30 derniers jours",
    pagination: {
      total: 8,
      page: 1,
      limit: 25,
      totalPages: 1,
      rangeFrom: 1,
      rangeTo: 8,
    },
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    ...over,
  };
  const utils = render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <ProductsRowList {...props} />
    </NextIntlClientProvider>,
  );
  return { ...utils, props };
}

function chip(name: string | RegExp) {
  return screen.getByRole("button", { name });
}

describe("ProductsRowList", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders one row per product", () => {
    renderList();
    expect(screen.getAllByRole("link", { name: /Ouvrir la fiche de/ })).toHaveLength(2);
  });

  it("exposes every facet the server answered with, and only those", () => {
    renderList({ facets: { all: 8, active: 5, outOfStock: 2 } });
    expect(chip(/Tous/)).toBeInTheDocument();
    expect(chip(/Actifs/)).toBeInTheDocument();
    expect(chip(/Rupture/)).toBeInTheDocument();
    // A metric facet is ABSENT (not 0) when metrics could not be computed.
    expect(screen.queryByRole("button", { name: /Perte/ })).toBeNull();
  });

  it("keeps all eight facets reachable", () => {
    renderList();
    for (const label of [
      "Tous",
      "Actifs",
      "Rupture",
      "Stock bas",
      "Perte",
      "Marge faible",
      "Sans ventes",
      "Inactifs",
    ]) {
      expect(chip(new RegExp(label))).toBeInTheDocument();
    }
  });

  it("filters on click", () => {
    const onFacetChange = vi.fn();
    renderList({ onFacetChange });
    fireEvent.click(chip(/Rupture/));
    expect(onFacetChange).toHaveBeenCalledWith("outOfStock");
  });

  it("returns to 'all' when the active facet is clicked again", () => {
    const onFacetChange = vi.fn();
    renderList({ facet: "outOfStock", onFacetChange });
    fireEvent.click(chip(/Rupture/));
    expect(onFacetChange).toHaveBeenCalledWith("all");
  });

  it("marks the active facet pressed", () => {
    renderList({ facet: "losingMoney" });
    expect(chip(/Perte/).getAttribute("aria-pressed")).toBe("true");
    expect(chip(/Actifs/).getAttribute("aria-pressed")).toBe("false");
  });

  it("makes an empty facet unactionable rather than opening an empty list", () => {
    renderList();
    expect(chip(/Stock bas/)).toBeDisabled();
    expect(chip(/Rupture/)).not.toBeDisabled();
  });

  it("tints a non-empty exception facet at rest", () => {
    renderList();
    expect(chip(/Rupture/).getAttribute("data-tone")).toBe("bad");
    expect(chip(/Sans ventes/).getAttribute("data-tone")).toBe("warn");
    expect(chip(/Actifs/).getAttribute("data-tone")).toBeNull();
  });

  it("pushes the search term to the parent after the debounce", () => {
    vi.useFakeTimers();
    const onSearchChange = vi.fn();
    renderList({ onSearchChange });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: " boxe " } });
    expect(onSearchChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onSearchChange).toHaveBeenCalledWith("boxe");
  });

  it("keeps every sort key reachable from the sort menu", () => {
    renderList();
    fireEvent.click(chip(/Trier/));
    for (const label of [
      "Nom",
      "Stock",
      "COGS unitaire",
      "Chiffre d'affaires",
      "Profit net",
      "Marge nette",
      "Taux de confirmation",
      "Taux de livraison",
      "Taux de retour",
      "Commandes reçues",
      "Statut",
    ]) {
      // Scoped to the open panel — "Stock" the sort key and "Stock bas" the
      // facet are both buttons on this screen. Anchored at the start because the
      // ACTIVE key also announces its direction ("Nom Croissant"), deliberately.
      expect(
        within(screen.getByRole("dialog")).getByRole("button", { name: new RegExp(`^${label}\\b`) }),
      ).toBeInTheDocument();
    }
  });

  it("sorts descending by default on a new key, ascending on the name", () => {
    const onSortChange = vi.fn();
    renderList({ onSortChange, sort: "name", dir: "asc" });
    fireEvent.click(chip(/Trier/));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Profit net\b/ }));
    expect(onSortChange).toHaveBeenCalledWith("net_profit", "desc");
  });

  it("flips the direction when the active sort key is picked again", () => {
    const onSortChange = vi.fn();
    renderList({ onSortChange, sort: "net_profit", dir: "desc" });
    fireEvent.click(chip(/Trier/));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Profit net\b/ }));
    expect(onSortChange).toHaveBeenCalledWith("net_profit", "asc");
  });

  it("selects every row on the page from one control", () => {
    const onToggleSelectAll = vi.fn();
    renderList({ onToggleSelectAll });
    fireEvent.click(screen.getByRole("checkbox", { name: frMessages.products.table.selectAll }));
    expect(onToggleSelectAll).toHaveBeenCalled();
  });

  it("switches density", () => {
    const { container } = renderList();
    fireEvent.click(chip(/Densité/));
    fireEvent.click(screen.getByRole("button", { name: "Compact" }));
    expect(container.querySelector("[data-density]")?.getAttribute("data-density")).toBe("compact");
  });

  it("renders the bulk action bar it is handed", () => {
    renderList({ bulkBar: <div>2 sélectionnées</div> });
    expect(screen.getByText("2 sélectionnées")).toBeInTheDocument();
  });

  it("keeps the server pagination under the rows", () => {
    renderList();
    expect(screen.getByRole("button", { name: frMessages.pagination.next })).toBeInTheDocument();
  });

  it("shows a skeleton on the first load only", () => {
    renderList({ loading: true, rows: [] });
    expect(screen.getByRole("status", { name: frMessages.products.table.loading })).toBeInTheDocument();
  });

  it("tells an empty catalogue apart from an empty search", () => {
    const { unmount } = renderList({ rows: [], search: "" });
    expect(screen.getByText(frMessages.products.emptyState)).toBeInTheDocument();
    unmount();

    renderList({ rows: [], search: "boxe" });
    expect(screen.getByText(frMessages.products.emptySearchTitle)).toBeInTheDocument();
    expect(screen.getByText(/boxe/)).toBeInTheDocument();
  });

  it("summarises the catalogue and the period", () => {
    renderList();
    expect(screen.getByText(/8 produit\(s\) · 5 actif\(s\)/)).toBeInTheDocument();
    expect(screen.getByText("30 derniers jours")).toBeInTheDocument();
  });
});
