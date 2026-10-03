import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import arMessages from "@/messages/ar.json";
import { WarehouseStockClient } from "../WarehouseStockClient";
import type { WarehouseStockRow } from "@/app/api/warehouse/stock/route";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const row = (id: string, counted: string | null): WarehouseStockRow => ({
  product_id: id, name: `منتج ${id}`, sku: null, image_url: null, current_stock: 20,
  low_stock_threshold: 5, stock_goal: null, goal_pct: null, damaged_return_count: 0,
  engaged: 2, free: 18, accuracy: null, series: [], sites: [], unallocated: 0,
  incoming: null, variants: [], last_counted_at: counted,
});

vi.mock("swr", () => ({
  default: () => ({
    data: { rows: [row("a", "2026-09-29T10:00:00Z"), row("b", null)], warehouses: [] },
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

afterEach(cleanup);

/**
 * The Libyan desk reads Arabic. Every word on the table — the headers, the
 * « jamais » chip, the date of the last count — comes in the reader's language,
 * with Latin digits like every other figure in Ordra.
 */
describe("WarehouseStockClient — Arabic locale", () => {
  it("speaks Arabic on every word of the table", () => {
    const { container } = render(
      <NextIntlClientProvider locale="ar" messages={arMessages}>
        <WarehouseStockClient locale="ar" variant="desk" siteId={null} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("columnheader", { name: "السجل" })).toBeInTheDocument();
    const text = container.textContent ?? "";
    expect(text).toContain("أبداً");
    expect(text).toMatch(/29 سبتمبر/);
    expect(text).not.toMatch(/jamais|sept\.|Registre/);
  });
});
