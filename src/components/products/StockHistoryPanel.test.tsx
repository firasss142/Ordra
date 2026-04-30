import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SWRConfig } from "swr";
import { StockHistoryPanel } from "./StockHistoryPanel";
import frMessages from "@/messages/fr.json";

function renderPanel(productId = "p-1") {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <StockHistoryPanel productId={productId} locale="fr" />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StockHistoryPanel", () => {
  it("renders the empty state when no rows", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], pagination: { page: 1, limit: 20, total: 0 } }),
    });
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText(frMessages.productPnl.stockHistory.empty)).toBeInTheDocument(),
    );
  });

  it("renders column headers from translations", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "row-1",
            product_id: "p-1",
            order_id: null,
            change: 5,
            reason: "initial_stock",
            note: null,
            actor_id: null,
            created_at: "2026-01-15T10:00:00Z",
          },
        ],
        pagination: { page: 1, limit: 20, total: 1 },
      }),
    });
    renderPanel();
    await waitFor(() =>
      expect(
        screen.getByRole("columnheader", { name: frMessages.productPnl.stockHistory.colDate }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("columnheader", { name: frMessages.productPnl.stockHistory.colMovement }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: frMessages.productPnl.stockHistory.colReason }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: frMessages.productPnl.stockHistory.colNote }),
    ).toBeInTheDocument();
  });

  it("renders positive movement with success styling and a + sign", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "row-pos",
            product_id: "p-1",
            order_id: null,
            change: 7,
            reason: "initial_stock",
            note: null,
            actor_id: null,
            created_at: "2026-01-15T10:00:00Z",
          },
        ],
        pagination: { page: 1, limit: 20, total: 1 },
      }),
    });
    renderPanel();
    const cell = await screen.findByText("+7");
    expect(cell.className).toContain("text-status-success");
  });

  it("renders negative movement with critical styling", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "row-neg",
            product_id: "p-1",
            order_id: null,
            change: -3,
            reason: "deposit",
            note: null,
            actor_id: null,
            created_at: "2026-01-15T10:00:00Z",
          },
        ],
        pagination: { page: 1, limit: 20, total: 1 },
      }),
    });
    renderPanel();
    const cell = await screen.findByText("-3");
    expect(cell.className).toContain("text-status-critical");
  });

  it("disables Previous button on the first page", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: Array.from({ length: 20 }, (_, i) => ({
          id: `row-${i}`,
          product_id: "p-1",
          order_id: null,
          change: 1,
          reason: "initial_stock",
          note: null,
          actor_id: null,
          created_at: "2026-01-15T10:00:00Z",
        })),
        pagination: { page: 1, limit: 20, total: 40 },
      }),
    });
    renderPanel();
    const prevBtn = await screen.findByRole("button", { name: frMessages.productPnl.stockHistory.prev });
    expect(prevBtn).toBeDisabled();
  });
});
