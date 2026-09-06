import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import arMessages from "@/messages/ar.json";
import { WarehouseStockClient } from "../WarehouseStockClient";
import type { WarehouseStockRow } from "@/app/api/warehouse/stock/route";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const H = 3_600_000;
const row = (id: string, countedAgoMs: number | null): WarehouseStockRow =>
  ({
    product_id: id,
    name: `منتج ${id}`,
    sku: null,
    image_url: null,
    current_stock: 20,
    low_stock_threshold: 5,
    stock_goal: null,
    goal_pct: null,
    damaged_return_count: 0,
    engaged: 2,
    free: 18,
    accuracy: null,
    series: [],
    last_counted_at: countedAgoMs === null ? null : new Date(Date.now() - countedAgoMs).toISOString(),
  }) as unknown as WarehouseStockRow;

vi.mock("swr", () => ({
  default: () => ({
    data: { rows: [row("a", 2 * H), row("b", 30 * H), row("c", 3 * 24 * H + H)] },
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

afterEach(cleanup);

/**
 * The stock table's "last counted" column on the Libyan console. The phone
 * card already spoke Arabic; the desk table next to it still said
 * "aujourd'hui" / "hier" / "il y a 3 j".
 */
describe("WarehouseStockClient — Arabic locale", () => {
  it("writes the last-count day in Arabic everywhere it appears", () => {
    const { container } = render(
      <NextIntlClientProvider locale="ar" messages={arMessages}>
        <WarehouseStockClient locale="ar" />
      </NextIntlClientProvider>,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("جُرد اليوم");
    expect(text).toContain("جُرد أمس");
    expect(text).toContain("جُرد قبل 3 يوم");
    expect(text).not.toMatch(/aujourd'hui|\bhier\b|il y a/);
  });
});
