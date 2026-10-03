import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/messages/fr.json";
import arMessages from "@/messages/ar.json";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import type { OrderZone } from "@/lib/warehouse/zone-index";
import type { FoldSummary } from "@/lib/warehouse/desk-sortir";
import { PreparationConsole } from "../PreparationConsole";
import { DeskScanProvider, useDeskScan } from "@/components/warehouse/desk/DeskScanContext";

/**
 * Desk Sortir — « À scanner ».
 *
 * One table card, grouped by Darb sticker roll: a roll row (swatch, colour,
 * zone, count, « Commencer la tournée »), then its parcels — product × qty,
 * destination, first name, age, building, « Prendre ». The parcel taken is the
 * parcel in hand: its row is tinted and the top bar asks for that roll's
 * sticker. A fold row closes the card with the parcels set aside per building.
 *
 * No KPI tiles, no search, no filter pills, no price, no stock, no side
 * scanner: the building switch in the top bar is the filter and the top bar's
 * field is the scanner.
 */

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const GREEN: OrderZone = {
  branchGroup: "BN", colorHex: "#339307", colourFr: "Vert",
  nameFr: "Région orientale", nameAr: "المنطقة الشرقية", source: "carrier",
};
const RED: OrderZone = {
  branchGroup: "TR", colorHex: "#d80a0a", colourFr: "Rouge",
  nameFr: "Tripoli et banlieue", nameAr: "طرابلس وضواحيها", source: "carrier",
};

type Row = WarehouseOrderRow & { zone: OrderZone };

let n = 0;
function row(over: Partial<Row> = {}): Row {
  n += 1;
  return {
    id: `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`,
    customer_name: "Meryem Ben Ali",
    customer_phone: "+218",
    customer_city: "Derna",
    customer_area: null,
    customer_address: null,
    product_id: "p1",
    product_name: "Coran Tadabbur",
    variant_label: null,
    quantity: 1,
    total_price: 120,
    status: "uploaded",
    created_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    uploaded_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    branch_group: "BN",
    tracking_number: "SH1",
    carrier_sticker_ref: null,
    carrier_status_slug: null,
    has_carrier_ref: true,
    current_stock: 929,
    low_stock_threshold: 5,
    warehouse_id: "site-b",
    zone: GREEN,
    ...over,
  } as Row;
}

const SITES = { "site-t": "Tripoli", "site-b": "Benghazi" };
const NO_FOLD: FoldSummary = { total: 0, parts: [] };

function HandProbe() {
  const { hand } = useDeskScan();
  return <output data-testid="probe-hand">{hand?.id ?? ""}</output>;
}

function renderTable(
  orders: Row[],
  opts: { locale?: "fr" | "ar"; market?: "ly" | "tn"; fold?: FoldSummary; warehouseId?: string | null } = {},
) {
  const { locale = "fr", market = "ly", fold = NO_FOLD, warehouseId = null } = opts;
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "ar" ? arMessages : frMessages}>
      <DeskScanProvider>
        <PreparationConsole
          market={market}
          orders={orders}
          siteNames={SITES}
          fold={fold}
          warehouseId={warehouseId}
        />
        <HandProbe />
      </DeskScanProvider>
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("Sortir · À scanner — the table", () => {
  it("has the prototype's columns, in order", () => {
    renderTable([row()]);
    const heads = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(heads).toEqual(["Colis", "Destination", "Client", "Âge", "Bâtiment", ""]);
  });

  it("opens each sticker roll with its swatch, colour, zone, count and the run", () => {
    renderTable([row(), row(), row({ zone: RED, customer_city: "Tripoli" })]);
    const rolls = screen.getAllByTestId("wh-desk-rollrow");
    // Darb's own order: red before green.
    expect(rolls.map((r) => r.dataset.roll)).toEqual(["#d80a0a", "#339307"]);
    const green = rolls[1];
    expect(within(green).getByTestId("wh-desk-swatch").style.background).toBe("rgb(51, 147, 7)");
    expect(green.textContent).toContain("Rouleau Vert");
    expect(green.textContent).toContain("Région orientale");
    expect(within(green).getByTestId("wh-desk-rollcount").textContent).toBe("2");
    expect(within(green).getByRole("link", { name: "Commencer la tournée" })).toHaveAttribute(
      "href",
      "/fr/warehouse/scan?roll=%23339307",
    );
  });

  it("keeps the building on the run link when one is chosen", () => {
    renderTable([row()], { warehouseId: "site-b" });
    expect(screen.getByRole("link", { name: "Commencer la tournée" })).toHaveAttribute(
      "href",
      "/fr/warehouse/scan?roll=%23339307&warehouse_id=site-b",
    );
  });

  it("shows product × quantity, destination, first name, age and building — nothing else", () => {
    renderTable([row({ quantity: 2 })]);
    const parcel = screen.getByTestId("wh-desk-parcel");
    const cells = within(parcel).getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toEqual(["Coran Tadabbur×2", "Derna", "Meryem", "3 h", "Benghazi", "Prendre"]);
    // The price, the stock and the Darb badge are gone.
    expect(parcel.textContent).not.toMatch(/120|929|Darb/);
  });

  it("shows an age past two days as a warning chip, a younger one as plain text", () => {
    const old = new Date(Date.now() - 72 * 3_600_000).toISOString();
    renderTable([row(), row({ uploaded_at: old, created_at: old })]);
    const [fresh, late] = screen.getAllByTestId("wh-desk-age");
    expect(fresh.dataset.late).toBe("false");
    expect(late.dataset.late).toBe("true");
    expect(late.textContent).toBe("3 j");
  });

  it("says « à l'instant » under an hour", () => {
    const now = new Date().toISOString();
    renderTable([row({ uploaded_at: now, created_at: now })]);
    expect(screen.getByTestId("wh-desk-age").textContent).toBe("à l'instant");
  });

  it("« Prendre » puts the parcel in hand: the row is tinted and says « En main »", () => {
    const a = row();
    const b = row();
    renderTable([a, b]);
    fireEvent.click(screen.getAllByRole("button", { name: "Prendre" })[0]);

    expect(screen.getByTestId("probe-hand").textContent).toBe(a.id);
    const [first, second] = screen.getAllByTestId("wh-desk-parcel");
    expect(first.dataset.hand).toBe("true");
    expect(within(first).getByText("En main")).toBeInTheDocument();
    expect(within(first).queryByRole("button", { name: "Prendre" })).toBeNull();
    expect(second.dataset.hand).toBe("false");
  });

  it("cannot take a parcel the carrier already sent out", () => {
    renderTable([row({ carrier_status_slug: "released" })]);
    expect(screen.getByRole("button", { name: "Prendre" })).toBeDisabled();
  });

  it("has no KPI tiles, no search box and no side scanner", () => {
    renderTable([row()]);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/File de préparation|Colis en retard|Déjà parti/)).toBeNull();
    expect(screen.queryByText(/Aucun colis en main/)).toBeNull();
  });

  it("says the bench is empty when it is", () => {
    renderTable([]);
    expect(screen.getByText("Aucun colis à scanner.")).toBeInTheDocument();
  });

  it("has no roll rows in Tunisia, which has no Darb rolls", () => {
    renderTable([row({ zone: { ...GREEN, colorHex: null, colourFr: null, nameFr: null, nameAr: null } })], {
      market: "tn",
    });
    expect(screen.queryByTestId("wh-desk-rollrow")).toBeNull();
    expect(screen.getByTestId("wh-desk-parcel")).toBeInTheDocument();
  });

  it("names an unresolved Libyan destination instead of drawing a blank roll", () => {
    renderTable([row({ zone: { ...GREEN, colorHex: null, colourFr: null, nameFr: null, nameAr: null } })]);
    const roll = screen.getByTestId("wh-desk-rollrow");
    expect(roll.textContent).toContain("Couleur à confirmer");
    expect(within(roll).queryByRole("link")).toBeNull();
  });
});

describe("Sortir · À scanner — the fold row", () => {
  it("counts the parcels set aside per building, with the switched-off carrier's share", () => {
    renderTable([row()], {
      fold: {
        total: 346,
        parts: [
          { site: "Tripoli", n: 335, dead: [{ carrier: "Dexpress", n: 323 }] },
          { site: "Benghazi", n: 11, dead: [] },
        ],
      },
    });
    const fold = screen.getByTestId("wh-desk-fold");
    expect(fold.textContent).toContain("Anciens — sans mouvement depuis plus de 10 jours · 346");
    expect(fold.textContent).toContain("Tripoli 335 (dont 323 Dexpress) · Benghazi 11 · toujours scannables");
  });

  it("is absent when nothing is set aside", () => {
    renderTable([row()]);
    expect(screen.queryByTestId("wh-desk-fold")).toBeNull();
  });
});

describe("Sortir · À scanner — in Arabic", () => {
  it("reads the roll, the zone, the age and the action in Arabic", () => {
    renderTable([row({ customer_city: "درنة", customer_name: "مريم علي" })], {
      locale: "ar",
      fold: { total: 11, parts: [{ site: "بنغازي", n: 11, dead: [] }] },
    });
    const roll = screen.getByTestId("wh-desk-rollrow");
    expect(roll.textContent).toContain("رولة أخضر");
    expect(roll.textContent).toContain("المنطقة الشرقية");
    expect(screen.getByRole("link", { name: "ابدأ الجولة" })).toBeInTheDocument();
    expect(screen.getByTestId("wh-desk-age").textContent).toBe("3 س");
    expect(screen.getByRole("button", { name: "خذ" })).toBeInTheDocument();
    expect(screen.getByTestId("wh-desk-fold").textContent).toContain("بنغازي 11 · قابلة للمسح دائماً");
    expect(document.body.textContent).not.toMatch(/Vert|Région|Prendre/);
  });
});
