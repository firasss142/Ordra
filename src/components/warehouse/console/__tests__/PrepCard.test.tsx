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

/**
 * The visual hierarchy of the card, as the bench actually uses it.
 *
 * The agent's loop is: read the roll colour → fetch that sticker → find this
 * parcel → take it → scan. The colour is the FIRST physical act and the only
 * one that cannot be undone cheaply (a wrong roll puts the parcel on the wrong
 * truck, and Darb accepts it without complaint). So it must dominate the card,
 * and the money — which the agent never acts on at this step — must not.
 */
describe("PrepCard — the roll colour leads", () => {
  it("shows a swatch large enough to read at arm's length", () => {
    render(<PrepCard row={make()} isLy hand={null} onTake={vi.fn()} currency="LYD" />);
    const swatch = screen.getByTestId("wh-prep-swatch");
    // The prototype's 10px dot is a status bullet; this is an instruction.
    expect(swatch.style.background).toBe("rgb(51, 147, 7)");
    expect(swatch.className).toMatch(/h-(1[0-9]|[2-9][0-9])/);
  });

  it("prints the roll name on the card surface, never on the colour", () => {
    // #339307 cannot carry legible text: 4.30:1 with ink, 3.95:1 with white.
    render(<PrepCard row={make()} isLy hand={null} onTake={vi.fn()} currency="LYD" />);
    const name = screen.getByTestId("wh-prep-roll-name");
    expect(name.textContent).toContain("Vert");
    expect(name.style.background).toBe("");
  });

  it("gives the collect amount less weight than the roll instruction", () => {
    render(<PrepCard row={make()} isLy hand={null} onTake={vi.fn()} currency="LYD" />);
    const amount = screen.getByTestId("wh-prep-amount");
    // The agent collects nothing at this bench — the courier does.
    expect(amount.className).not.toMatch(/font-bold/);
  });

  it("keeps the swatch out of the accessibility tree but names the colour in text", () => {
    render(<PrepCard row={make()} isLy hand={null} onTake={vi.fn()} currency="LYD" />);
    expect(screen.getByTestId("wh-prep-swatch")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("wh-prep-roll-name").textContent).toContain("Vert");
  });

  it("says the colour is unknown rather than showing a blank swatch", () => {
    render(
      <PrepCard
        row={make({}, zone({ colorHex: null, colourFr: null, nameFr: null }))}
        isLy
        hand={null}
        onTake={vi.fn()}
        currency="LYD"
      />,
    );
    expect(screen.getByTestId("wh-prep-roll-name").textContent).toMatch(/confirmer|inconnue/i);
  });

  it("Tunisia gets no roll furniture at all", () => {
    render(<PrepCard row={make()} isLy={false} hand={null} onTake={vi.fn()} currency="TND" />);
    expect(screen.queryByTestId("wh-prep-swatch")).toBeNull();
    expect(screen.queryByTestId("wh-prep-roll-name")).toBeNull();
  });
});
