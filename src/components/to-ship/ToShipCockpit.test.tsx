import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";
import type { ToShipRow } from "@/lib/to-ship/types";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const resolve = (key: string, params?: Record<string, unknown>) => {
      const parts = namespace ? `${namespace}.${key}`.split(".") : key.split(".");
      let val: unknown = frMessages;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      if (typeof val !== "string") return key;
      if (params) {
        return Object.entries(params).reduce(
          (s, [k, v]) => s.replace(`{${k}}`, String(v)),
          val,
        );
      }
      return val;
    };
    return resolve;
  },
}));

vi.mock("@/lib/pdf-utils", () => ({ openPdfBlob: vi.fn() }));

import { ToShipCockpit } from "./ToShipCockpit";

function row(overrides: Partial<ToShipRow>): ToShipRow {
  return {
    id: Math.random().toString(36).slice(2),
    customer_name: "Ahmed",
    customer_city: "Tunis",
    product_id: "p-1",
    product_name: "Tee",
    variant_label: null,
    quantity: 1,
    total_price: 50,
    status: "confirmed",
    current_stock: 100,
    low_stock_threshold: 5,
    scheduled_at: null,
    scheduled_auto: false,
    scheduled_carrier_id: null,
    ...overrides,
  };
}

const carriers = [
  { id: "c-1", code: "navex", label: "Navex" },
  { id: "c-2", code: "dexpress", label: "Dexpress" },
];

beforeEach(() => {
  vi.clearAllMocks();
  (global.fetch as unknown) = vi.fn();
});

describe("ToShipCockpit", () => {
  it("renders shippable rows grouped by city by default and hides dispatch_scheduled from the table", () => {
    const rows = [
      row({ id: "a", customer_city: "Tunis", status: "confirmed" }),
      row({ id: "b", customer_city: "Sfax", status: "confirmed" }),
      row({
        id: "c",
        customer_city: "Sousse",
        status: "dispatch_scheduled",
        scheduled_at: new Date().toISOString(),
      }),
    ];
    render(<ToShipCockpit rows={rows} carriers={carriers} currency="TND" />);
    // Tunis and Sfax appear as group headings; Sousse (dispatch_scheduled) is excluded.
    expect(screen.getAllByText("Tunis").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sfax").length).toBeGreaterThan(0);
    expect(screen.queryByText("Sousse")).toBeNull();
  });

  it("switches grouping to product when the product tab is clicked", async () => {
    const user = userEvent.setup();
    const rows = [
      row({ id: "a", product_name: "Tee", product_id: "p-1", customer_city: "Tunis" }),
      row({ id: "b", product_name: "Hoodie", product_id: "p-2", customer_city: "Sfax" }),
    ];
    render(<ToShipCockpit rows={rows} carriers={carriers} currency="TND" />);
    await user.click(screen.getByRole("tab", { name: /par produit/i }));
    expect(screen.getByRole("tab", { name: /par produit/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Each product name appears in its group header AND its row — both present is fine
    expect(screen.getAllByText("Tee").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Hoodie").length).toBeGreaterThan(0);
  });

  it("shows the bulk bar when rows are selected and hides it when selection is cleared", async () => {
    const user = userEvent.setup();
    const rows = [row({ id: "a" })];
    render(<ToShipCockpit rows={rows} carriers={carriers} currency="TND" />);
    expect(screen.queryByRole("region", { name: /actions groupées/i })).toBeNull();
    const checkbox = screen.getByLabelText(/sélectionner la commande/i);
    await user.click(checkbox);
    const bar = screen.getByRole("region", { name: /actions groupées/i });
    expect(bar).toBeDefined();
    await user.click(within(bar).getByText(/effacer/i));
    expect(screen.queryByRole("region", { name: /actions groupées/i })).toBeNull();
  });

  it("flags stock warning when cumulative selection drops stock below threshold", () => {
    const rows = [
      row({
        id: "a",
        product_id: "p-1",
        quantity: 3,
        current_stock: 6,
        low_stock_threshold: 5,
      }),
    ];
    render(<ToShipCockpit rows={rows} carriers={carriers} currency="TND" />);
    // 6 - 3 = 3 < threshold 5 → warning renders
    expect(screen.getByText(/stock faible après expédition/i)).toBeDefined();
  });

  it("posts selected order_ids + carrier_id to bulk-dispatch and surfaces success feedback", async () => {
    const user = userEvent.setup();
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        succeeded: [{ order_id: "a", tracking_number: "T-1" }],
        failed: [],
      }),
    });
    const rows = [row({ id: "a" })];
    render(<ToShipCockpit rows={rows} carriers={carriers} currency="TND" />);
    await user.click(screen.getByLabelText(/sélectionner la commande/i));
    await user.click(screen.getByRole("button", { name: /^expédier$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/orders/bulk-dispatch",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ order_ids: ["a"], carrier_id: "c-1" }),
        }),
      );
    });
    expect(await screen.findByText(/1 commandes expédiées/i)).toBeDefined();
  });

  it("keeps failed rows selected for retry after a partial bulk-dispatch", async () => {
    const user = userEvent.setup();
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        succeeded: [{ order_id: "a", tracking_number: "T-1" }],
        failed: [{ order_id: "b", error: "bad city", errorCode: "NAVEX_VALIDATION" }],
      }),
    });
    const rows = [row({ id: "a" }), row({ id: "b" })];
    render(<ToShipCockpit rows={rows} carriers={carriers} currency="TND" />);

    const checkboxes = screen.getAllByLabelText(/sélectionner la commande/i);
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);
    await user.click(screen.getByRole("button", { name: /^expédier$/i }));

    await screen.findByText(/1 expédiées, 1 en échec/i);
    // bulk bar should still be visible with 1 selected (the failed one)
    const bar = screen.getByRole("region", { name: /actions groupées/i });
    expect(within(bar).getByText(/1 sélectionnées/i)).toBeDefined();
  });
});
