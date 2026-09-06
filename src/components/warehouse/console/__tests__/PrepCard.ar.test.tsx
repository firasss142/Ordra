import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import arMessages from "@/messages/ar.json";
import { PrepCard } from "../PrepCard";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import type { OrderZone } from "@/lib/warehouse/zone-index";

/**
 * The Libyan agent reads the bench in Arabic. The roll colour is the first
 * physical instruction on the card, so it must be in the agent's language —
 * "Vert" on an Arabic phone is a colour the agent has to translate in their
 * head before walking to the shelf.
 */
const zone: OrderZone = {
  colorHex: "#339307",
  colourFr: "Vert",
  nameFr: "Région orientale",
  nameAr: "المنطقة الشرقية",
  branchGroup: "BN",
  source: "directory",
};

const row = (over: Partial<WarehouseOrderRow> = {}) => ({
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
  quantity: 2,
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

function renderAr(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="ar" messages={arMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("PrepCard — Arabic locale", () => {
  it("names the roll colour and the zone in Arabic", () => {
    renderAr(<PrepCard row={row()} isLy hand={null} onTake={() => {}} currency="د.ل" />);
    const roll = screen.getByTestId("wh-prep-roll").textContent ?? "";
    expect(roll).toContain("أخضر");
    expect(roll).toContain("المنطقة الشرقية");
    expect(roll).not.toMatch(/Vert|Région/);
  });

  it("falls back to the Arabic 'colour to confirm' when the zone is unknown", () => {
    const r = row();
    r.zone = { ...zone, colorHex: null, colourFr: null, nameFr: null, nameAr: null, source: "unknown" };
    renderAr(<PrepCard row={r} isLy hand={null} onTake={() => {}} currency="د.ل" />);
    expect(screen.getByTestId("wh-prep-roll").textContent).toContain("اللون بحاجة إلى تأكيد");
  });

  it("writes the bench age with the Arabic hour unit", () => {
    renderAr(<PrepCard row={row()} isLy hand={null} onTake={() => {}} currency="د.ل" />);
    expect(screen.getByTestId("wh-prep-age").textContent).toBe("3 س");
  });

  it("writes the bench age in Arabic days past 24 hours", () => {
    const r = row({ uploaded_at: new Date(Date.now() - 72 * 3_600_000).toISOString() });
    renderAr(<PrepCard row={r} isLy hand={null} onTake={() => {}} currency="د.ل" />);
    expect(screen.getByTestId("wh-prep-age").textContent).toBe("3 ي");
  });
});
