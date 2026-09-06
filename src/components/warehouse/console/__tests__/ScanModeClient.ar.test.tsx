import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import arMessages from "@/messages/ar.json";
import { ScanModeClient } from "../ScanModeClient";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import type { OrderZone } from "@/lib/warehouse/zone-index";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("swr", () => ({
  default: (_k: string, _f: unknown, opts: { fallbackData: unknown }) => ({
    data: opts.fallbackData,
    mutate: vi.fn(),
  }),
}));
vi.mock("../ScanStation", () => ({ ScanStation: () => null }));

const zone: OrderZone = {
  colorHex: "#339307",
  colourFr: "Vert",
  nameFr: "Région orientale",
  nameAr: "المنطقة الشرقية",
  branchGroup: "BN",
  source: "directory",
};

const order = {
  id: "aaaaaaaa-1111-2222-3333-444444444444",
  customer_name: "Mouna Zouaghi",
  customer_phone: "218",
  customer_city: "بنغازي",
  customer_area: null,
  customer_address: null,
  uploaded_at: new Date().toISOString(),
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
  zone,
} as WarehouseOrderRow & { zone: OrderZone };

function renderAr() {
  return render(
    <NextIntlClientProvider locale="ar" messages={arMessages}>
      <ScanModeClient locale="ar" initialOrders={[order]} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

/**
 * Scan mode on the Libyan agent's phone. The picker's rows must name the
 * roll colour in Arabic, and the "Esc to leave" hint is a keyboard
 * instruction — a phone has no Escape key.
 */
describe("ScanModeClient — Arabic locale", () => {
  it("names the matched parcel's roll colour in Arabic", () => {
    renderAr();
    fireEvent.change(screen.getByPlaceholderText(arMessages.warehouse.prep2.search), {
      target: { value: "mouna" },
    });
    const match = screen.getByRole("button", { name: /Mouna Zouaghi/ });
    expect(match.textContent).toContain("أخضر");
    expect(match.textContent).not.toContain("Vert");
  });

  it("writes the leave hint with 'Esc', not the French key name", () => {
    renderAr();
    expect(screen.getByText(/Esc/).textContent).not.toContain("Échap");
  });

  it("hides the Esc hint on a phone, which has no Escape key", () => {
    renderAr();
    const hint = screen.getByText(/Esc/);
    expect(hint.className).toMatch(/\bhidden\b/);
    expect(hint.className).toMatch(/\bmd:block\b/);
  });
});
