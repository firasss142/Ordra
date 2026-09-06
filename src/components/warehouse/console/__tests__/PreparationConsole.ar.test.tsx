import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import arMessages from "@/messages/ar.json";
import { PreparationConsole } from "../PreparationConsole";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import type { OrderZone } from "@/lib/warehouse/zone-index";

vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));

let page: Record<string, unknown> = { orders: [] };

vi.mock("swr", () => ({
  default: () => ({ data: page, error: undefined, isLoading: false, mutate: vi.fn() }),
}));

const zone: OrderZone = {
  colorHex: "#339307",
  colourFr: "Vert",
  nameFr: "Région orientale",
  nameAr: "المنطقة الشرقية",
  branchGroup: "BN",
  source: "directory",
};

const order = (over: Partial<WarehouseOrderRow> = {}) => ({
  id: "aaaaaaaa-1111-2222-3333-444444444444",
  customer_name: "منى الزواغي",
  customer_phone: "218",
  customer_city: "بنغازي",
  customer_area: null,
  customer_address: null,
  uploaded_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  branch_group: "BN",
  product_id: "p1",
  product_name: "كيس ملاكمة",
  variant_label: null,
  quantity: 1,
  total_price: 179,
  status: "uploaded",
  created_at: new Date().toISOString(),
  tracking_number: null,
  carrier_sticker_ref: null,
  carrier_status_slug: null,
  has_carrier_ref: true,
  current_stock: 50,
  low_stock_threshold: 10,
  ...over,
  zone,
}) as WarehouseOrderRow & { zone: OrderZone };

function renderAr() {
  return render(
    <NextIntlClientProvider locale="ar" messages={arMessages}>
      <PreparationConsole market="ly" initialOrders={[]} dailyGoal={40} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  page = { orders: [] };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(cleanup);

/**
 * The Libyan bench in Arabic. Every word the agent reads while holding a
 * parcel must be in their language: the market name, the roll colour, the
 * zone, and the age units.
 */
describe("PreparationConsole — Arabic locale", () => {
  it("names the market in Arabic in the subtitle", () => {
    const { container } = renderAr();
    expect(container.textContent).toContain("ليبيا");
    expect(container.textContent).not.toContain("Libye");
  });

  it("labels the zone band with the Arabic colour and zone name", () => {
    page = { orders: [order()], total: 1 };
    const { container } = renderAr();
    expect(container.textContent).toContain("أخضر");
    expect(container.textContent).toContain("المنطقة الشرقية");
    expect(container.textContent).not.toMatch(/Vert|Région/);
  });

  it("offers the zone filter options in Arabic", () => {
    page = { orders: [order()], total: 1 };
    renderAr();
    fireEvent.click(screen.getByRole("button", { name: "اللون" }));
    expect(screen.getByRole("button", { name: "أخضر — المنطقة الشرقية" })).toBeInTheDocument();
  });

  it("writes the oldest-parcel age with the Arabic day unit", () => {
    page = { orders: [order()], total: 1, late: 1, oldestHours: 72 };
    const { container } = renderAr();
    expect(container.textContent).toContain("الأقدم: 3 ي");
    expect(container.textContent).not.toMatch(/\d+ j\b/);
  });

  it("writes the row age with the Arabic hour unit", () => {
    page = { orders: [order()], total: 1 };
    const { container } = renderAr();
    expect(container.textContent).toContain("3 س");
    expect(container.textContent).not.toMatch(/\b3 h\b/);
  });
});
