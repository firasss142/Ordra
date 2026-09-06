import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PrepCard } from "../PrepCard";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import type { OrderZone } from "@/lib/warehouse/zone-index";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useLocale: () => "fr",
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
  };
});

/**
 * One parcel on the bench, as the phone shows it.
 *
 * At 390px the desk table put PRODUIT and COMMANDE on top of each other and
 * printed "PRODUMANDE". The card carries the same six facts in reading order
 * instead — and, for Libya, the roll colour, which decides which sticker the
 * agent must physically pick up before touching the parcel.
 */
const zone = (over: Partial<OrderZone> = {}): OrderZone => ({
  colorHex: "#339307",
  colourFr: "Vert",
  nameFr: "Région Est",
  nameAr: "المنطقة الشرقية",
  branchGroup: "BN",
  source: "directory",
  ...over,
} as OrderZone);

const row = (over: Partial<WarehouseOrderRow> = {}) => ({
  id: "aaaaaaaa-1111-2222-3333-444444444444",
  customer_name: "Mouna Zouaghi",
  customer_phone: "216",
  customer_city: "بنغازي",
  customer_area: null,
  customer_address: null,
  uploaded_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  branch_group: "BN",
  product_id: "p1",
  product_name: "Sac de frappe",
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
}) as WarehouseOrderRow & { zone: OrderZone };

const make = (over: Partial<WarehouseOrderRow> = {}, z = zone()) => ({ ...row(over), zone: z });

afterEach(cleanup);

describe("PrepCard", () => {
  it("names the customer and the destination without truncating to one letter", () => {
    render(<PrepCard row={make()} isLy hand={null} onTake={() => {}} currency="LYD" />);
    expect(screen.getByText("Mouna Zouaghi")).toBeInTheDocument();
    expect(screen.getByText(/بنغازي/)).toBeInTheDocument();
  });

  it("shows the roll colour by name, not only as a dot", () => {
    // Two of the nine Darb colours are ~ΔE 10 apart. Colour alone is not an
    // instruction; the agent has to be told which roll to pick up.
    render(<PrepCard row={make()} isLy hand={null} onTake={() => {}} currency="LYD" />);
    expect(screen.getByTestId("wh-prep-roll").textContent).toMatch(/Vert/);
  });

  it("hides the roll strip for Tunisia, which prints its own labels", () => {
    render(<PrepCard row={make()} isLy={false} hand={null} onTake={() => {}} currency="TND" />);
    expect(screen.queryByTestId("wh-prep-roll")).toBeNull();
  });

  it("refuses to offer a parcel the carrier already took", () => {
    render(
      <PrepCard row={make({ carrier_status_slug: "released" })} isLy hand={null} onTake={() => {}} currency="LYD" />,
    );
    expect(screen.getByRole("button", { name: /prendre/i })).toBeDisabled();
  });

  it("warns when the sticker could never bind, before the agent walks to the shelf", () => {
    render(
      <PrepCard row={make({ has_carrier_ref: false })} isLy hand={null} onTake={() => {}} currency="LYD" />,
    );
    expect(screen.getByText(/non traçable/i)).toBeInTheDocument();
  });

  it("marks the parcel currently in hand", () => {
    const r = make();
    render(<PrepCard row={r} isLy hand={r} onTake={() => {}} currency="LYD" />);
    expect(screen.getByTestId("wh-prep-card").dataset.inHand).toBe("true");
  });

  it("measures age from the bench clock, not from intake", () => {
    // Uploaded three hours ago; created weeks ago in the fixture would read
    // as "21 j" on the intake clock.
    render(<PrepCard row={make()} isLy hand={null} onTake={() => {}} currency="LYD" />);
    expect(screen.getByTestId("wh-prep-age").textContent).toMatch(/3 h/);
  });

  it("gives the take action a thumb-sized target", () => {
    render(<PrepCard row={make()} isLy hand={null} onTake={() => {}} currency="LYD" />);
    expect(screen.getByRole("button", { name: /prendre/i }).className).toMatch(/min-h-\[44px\]/);
  });
});
