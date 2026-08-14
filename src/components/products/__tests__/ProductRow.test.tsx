import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, it, expect, vi, beforeEach } from "vitest";
import frMessages from "@/messages/fr.json";
import type { ProductListRow, ProductPeriodMetrics } from "@/types/product-list";
import { ProductRow } from "../ProductRow";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

/**
 * The `products.rowList.*` keys are merged into src/messages/*.json by the
 * dedicated i18n agent, so this suite carries its own copy of the FR table.
 * Once merged the values are identical and this spread becomes a no-op.
 */
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
  archive: "Archiver le produit",
  archiveOnlyInactive: "Désactivez le produit avant de l'archiver",
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

function makeRow(over: Partial<ProductListRow> = {}): ProductListRow {
  return {
    id: "p1",
    market_id: "m1",
    name: "Produit test",
    sku: "SKU-1",
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

type RowProps = React.ComponentProps<typeof ProductRow>;

function renderRow(over: Partial<RowProps> = {}) {
  const props: RowProps = {
    row: makeRow(),
    selected: false,
    onToggleSelect: vi.fn(),
    onToggleActive: vi.fn(),
    onAdjustStock: vi.fn(),
    canManage: true,
    canToggleActive: true,
    canArchive: true,
    onArchive: vi.fn(),
    locale: "fr",
    currency: "LYD",
    density: "comfortable",
    ...over,
  };
  const utils = render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <ProductRow {...props} />
    </NextIntlClientProvider>,
  );
  return { ...utils, props };
}

function row() {
  return screen.getByRole("link", { name: /Ouvrir la fiche de/ });
}

describe("ProductRow", () => {
  beforeEach(() => {
    pushMock.mockReset();
  });

  it("renders the product name, its SKU and the active chip", () => {
    renderRow({ row: makeRow({ name: "دميه ملاكمه", sku: "box-wafra" }) });
    expect(screen.getByText("دميه ملاكمه")).toBeInTheDocument();
    expect(screen.getByText("box-wafra")).toBeInTheDocument();
    expect(screen.getByText("Actif")).toBeInTheDocument();
  });

  it("resolves the product name's own direction without flipping the row chrome", () => {
    renderRow({ row: makeRow({ name: "دميه ملاكمه" }) });
    expect(screen.getByText("دميه ملاكمه").getAttribute("dir")).toBe("auto");
    expect(row().getAttribute("dir")).toBeNull();
  });

  it("navigates to the product sheet when the row is clicked", () => {
    renderRow({ row: makeRow({ id: "abc-123" }) });
    fireEvent.click(row());
    expect(pushMock).toHaveBeenCalledWith("/fr/products/abc-123");
  });

  it("navigates on Enter", () => {
    renderRow({ row: makeRow({ id: "abc-123" }) });
    fireEvent.keyDown(row(), { key: "Enter" });
    expect(pushMock).toHaveBeenCalledWith("/fr/products/abc-123");
  });

  it("opens the actions menu without navigating", () => {
    renderRow();
    fireEvent.click(screen.getByRole("button", { name: frMessages.products.table.actions }));
    expect(screen.getByRole("menuitem", { name: "Modifier la fiche" })).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("sends the edit menu entry to the edit page", () => {
    renderRow({ row: makeRow({ id: "abc-123" }) });
    fireEvent.click(screen.getByRole("button", { name: frMessages.products.table.actions }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Modifier la fiche" }));
    expect(pushMock).toHaveBeenCalledWith("/fr/products/abc-123/edit");
  });

  it("selects without navigating", () => {
    const onToggleSelect = vi.fn();
    renderRow({ onToggleSelect, row: makeRow({ id: "abc-123" }) });
    fireEvent.click(screen.getByRole("checkbox", { name: /Sélectionner/ }));
    expect(onToggleSelect).toHaveBeenCalledWith("abc-123");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("hides the stock and duplicate entries when the actor cannot manage products", () => {
    renderRow({ canManage: false });
    fireEvent.click(screen.getByRole("button", { name: frMessages.products.table.actions }));
    expect(screen.queryByRole("menuitem", { name: "Ajuster le stock" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Dupliquer" })).toBeNull();
  });

  it("hides the activation entry when the actor cannot toggle products", () => {
    renderRow({ canToggleActive: false });
    fireEvent.click(screen.getByRole("button", { name: frMessages.products.table.actions }));
    expect(screen.queryByRole("menuitem", { name: "Désactiver" })).toBeNull();
  });

  it("toggles activation from the menu using the row's real is_active", () => {
    const onToggleActive = vi.fn();
    renderRow({ onToggleActive, row: makeRow({ id: "abc-123", is_active: true }) });
    fireEvent.click(screen.getByRole("button", { name: frMessages.products.table.actions }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Désactiver" }));
    expect(onToggleActive).toHaveBeenCalledWith("abc-123");
  });

  it("renders the three measure bands with their counts", () => {
    renderRow({
      row: makeRow({
        metrics: makeMetrics({ total_leads: 866, confirmed_count: 457, delivered_count: 108 }),
      }),
    });
    expect(within(screen.getByRole("group", { name: "Commandes" })).getByText("866")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Confirmées" })).getByText("457")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Livrées" })).getByText("108")).toBeInTheDocument();
  });

  it.each([
    [60, "good"],
    [50, "good"],
    [40, "warn"],
    [35, "warn"],
    [34.9, "bad"],
  ])("tones a %s%% confirmation rate as %s", (rate, tone) => {
    renderRow({ row: makeRow({ metrics: makeMetrics({ confirmation_rate: rate as number }) }) });
    const cell = screen.getByRole("group", { name: "Confirmées" });
    expect(cell.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe(tone);
  });

  it.each([
    [40, "good"],
    [30, "warn"],
    [25, "warn"],
    [24.9, "bad"],
  ])("tones a %s%% delivery rate as %s", (rate, tone) => {
    renderRow({ row: makeRow({ metrics: makeMetrics({ delivery_rate: rate as number }) }) });
    const cell = screen.getByRole("group", { name: "Livrées" });
    expect(cell.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe(tone);
  });

  it("reads delivery_rate off the wire instead of recomputing it", () => {
    // delivered/dispatched would be 25%; the server says 41.2 and the server wins.
    renderRow({
      row: makeRow({
        metrics: makeMetrics({ dispatched_count: 200, delivered_count: 50, delivery_rate: 41.2 }),
      }),
    });
    const cell = screen.getByRole("group", { name: "Livrées" });
    expect(within(cell).getByText(/41,2/)).toBeInTheDocument();
  });

  it("says so when nothing was ever uploaded rather than showing 0 %", () => {
    renderRow({
      row: makeRow({
        metrics: makeMetrics({ dispatched_count: 0, delivered_count: 0, delivery_rate: 0 }),
      }),
    });
    const cell = screen.getByRole("group", { name: "Livrées" });
    expect(within(cell).getByText("aucun upload")).toBeInTheDocument();
  });

  it("paints the profit inset in the brand tone and shows the margin when in profit", () => {
    renderRow({ row: makeRow({ metrics: makeMetrics({ revenue: 5000, net_profit: 1200, margin_pct: 24 }) }) });
    const inset = screen.getByRole("group", { name: "Profit net" });
    expect(inset.getAttribute("data-state")).toBe("positive");
    expect(within(inset).getByText(/Marge/)).toHaveTextContent("24,0");
  });

  it("paints the profit inset critical and rails the row when losing money", () => {
    renderRow({ row: makeRow({ metrics: makeMetrics({ revenue: 5000, net_profit: -300, margin_pct: -6 }) }) });
    expect(screen.getByRole("group", { name: "Profit net" }).getAttribute("data-state")).toBe("loss");
    expect(row().getAttribute("data-loss")).toBe("true");
  });

  it("keeps the profit inset NEUTRAL when revenue is zero, because a zero on green reads as an achievement", () => {
    renderRow({
      row: makeRow({
        metrics: makeMetrics({ total_leads: 12, revenue: 0, net_profit: -80, margin_pct: 0 }),
      }),
    });
    const inset = screen.getByRole("group", { name: "Profit net" });
    expect(inset.getAttribute("data-state")).toBe("flat");
    expect(within(inset).getByText("Coûts engagés, rien d'encaissé")).toBeInTheDocument();
    expect(within(inset).queryByText(/Marge/)).toBeNull();
  });

  it("does not rail a profitable row", () => {
    renderRow();
    expect(row().getAttribute("data-loss")).toBe("false");
  });

  it("shows an empty band instead of measures when the product has no orders", () => {
    renderRow({ row: makeRow({ metrics: makeMetrics({ total_leads: 0 }) }) });
    expect(screen.getByText("Aucune commande sur ce produit")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Confirmées" })).toBeNull();
  });

  it("distinguishes 'no metrics at all' from 'no orders'", () => {
    renderRow({ row: makeRow({ metrics: null }) });
    expect(screen.getByText("Chiffres indisponibles")).toBeInTheDocument();
    expect(screen.queryByText("Aucune commande sur ce produit")).toBeNull();
  });

  it("shows stock, threshold and the in-flight pill", () => {
    renderRow({
      row: makeRow({
        current_stock: 216,
        low_stock_threshold: 20,
        metrics: makeMetrics({ dispatched_count: 100, delivered_count: 50, returned_count: 10 }),
      }),
    });
    expect(screen.getByText(/216 en stock/)).toBeInTheDocument();
    expect(screen.getByText(/seuil 20/)).toBeInTheDocument();
    expect(screen.getByText(/40 en cours/)).toBeInTheDocument();
  });

  it("never renders a negative in-flight count", () => {
    renderRow({
      row: makeRow({
        metrics: makeMetrics({ dispatched_count: 10, delivered_count: 40, returned_count: 5 }),
      }),
    });
    expect(screen.getByText(/0 en cours/)).toBeInTheDocument();
  });

  it("flags an out-of-stock product", () => {
    renderRow({ row: makeRow({ current_stock: 0, low_stock_threshold: 10 }) });
    expect(screen.getByText(frMessages.products.facets.outOfStock)).toBeInTheDocument();
  });

  it("flags a low-stock product", () => {
    renderRow({ row: makeRow({ current_stock: 5, low_stock_threshold: 10 }) });
    expect(screen.getByText(frMessages.products.facets.lowStock)).toBeInTheDocument();
  });

  it("flags an inactive product", () => {
    renderRow({ row: makeRow({ is_active: false }) });
    expect(screen.getByText("Inactif")).toBeInTheDocument();
    expect(screen.queryByText("Actif")).toBeNull();
  });
});

/**
 * Archiver retire le produit de tous les sélecteurs de la console. C'est donc
 * un geste en deux temps — désactiver, regarder, puis archiver — et réservé au
 * rôle qui possède déjà la création, les coûts et le stock.
 */
describe("ProductRow — archivage", () => {
  beforeEach(() => pushMock.mockReset());

  const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /Actions/ }));

  it("n'offre pas l'archivage sur un produit actif", () => {
    renderRow({ row: makeRow({ is_active: true }), canArchive: true });
    openMenu();
    expect(screen.queryByRole("menuitem", { name: "Archiver le produit" })).toBeNull();
  });

  it("offre l'archivage sur un produit désactivé", () => {
    renderRow({ row: makeRow({ is_active: false }), canArchive: true });
    openMenu();
    expect(screen.getByRole("menuitem", { name: "Archiver le produit" })).toBeInTheDocument();
  });

  it("cache l'archivage à qui n'a pas la permission, même désactivé", () => {
    renderRow({ row: makeRow({ is_active: false }), canArchive: false });
    openMenu();
    expect(screen.queryByRole("menuitem", { name: "Archiver le produit" })).toBeNull();
  });

  it("remonte l'identité du produit au parent, qui porte la confirmation", () => {
    const onArchive = vi.fn();
    renderRow({
      row: makeRow({ id: "dead-1", name: "Vieux produit", is_active: false }),
      canArchive: true,
      onArchive,
    });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Archiver le produit" }));
    expect(onArchive).toHaveBeenCalledWith("dead-1", "Vieux produit");
    // Aucune navigation : l'archivage n'ouvre pas la fiche du produit qu'il retire.
    expect(pushMock).not.toHaveBeenCalled();
  });
});
