import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ScannedList } from "../ScannedList";
import { ScannedTable } from "@/components/warehouse/console/ScannedTable";
import { Intl } from "./fixtures";
import type { ScannedRow } from "@/app/api/warehouse/scanned/route";
import type { OrderZone } from "@/lib/warehouse/zone-index";

/**
 * The scanned list, narrowed.
 *
 * It shipped with no filters and two different sorts — the desk floated the
 * problems, the phone did not — so the same hundred rows read differently
 * depending on which device you held. Both surfaces are asserted here together,
 * because that is the property that broke.
 */

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const RED: OrderZone = {
  branchGroup: "TR", colorHex: "#d80a0a", colourFr: "Rouge",
  nameFr: "Tripoli et banlieue", nameAr: "طرابلس وضواحيها", source: "carrier",
};
const GREEN: OrderZone = {
  branchGroup: "BN", colorHex: "#339307", colourFr: "Vert",
  nameFr: "Région orientale", nameAr: "المنطقة الشرقية", source: "carrier",
};

let seq = 0;
function scanned(over: Partial<ScannedRow> = {}): ScannedRow {
  seq += 1;
  return {
    id: `s${seq}`,
    customer_name: `Client ${seq}`,
    customer_phone: null,
    customer_city: "طرابلس",
    customer_area: null,
    product_id: "p1",
    product_name: "Dumbbell",
    variant_label: null,
    quantity: 1,
    total_price: 100,
    status: "scanned",
    created_at: "2026-09-01T08:00:00.000Z",
    scanned_at: "2026-09-05T08:00:00.000Z",
    scanned_by_name: "Adel",
    tracking_number: null,
    carrier_sticker_ref: "7700001",
    carrier_status_slug: null,
    sticker_bind_state: "confirmed",
    carrier_reference_actual: null,
    branch_group: "TR",
    warehouse_id: null,
    carrier_name: null,
    current_stock: 5,
    low_stock_threshold: 1,
    zone: RED,
    ...over,
  } as ScannedRow;
}

const ok = scanned({ id: "ok", customer_name: "Sain", scanned_at: "2026-09-09T10:00:00.000Z" });
const broken = scanned({
  id: "broken", customer_name: "Cassé", sticker_bind_state: "not_registered",
  scanned_at: "2026-09-01T10:00:00.000Z", carrier_sticker_ref: "7700099",
});
const other = scanned({
  id: "other", customer_name: "Autre", product_name: "Corde", zone: GREEN,
  status: "at_carrier", scanned_by_name: "Nour",
});

const page = { orders: [ok, broken, other], nextCursor: null, awaitingPickup: 2, atCarrier: 1, unconfirmed: 1 };

vi.mock("swr", () => ({
  default: () => ({ data: page, error: undefined, isLoading: false, mutate: vi.fn() }),
}));

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const phone = () => render(<Intl locale="fr"><ScannedList isLy /></Intl>);
const desk = () => render(<Intl locale="fr"><ScannedTable isLy /></Intl>);

describe("both surfaces agree", () => {
  it("puts the parcels Darb is not holding first, on the phone as at the desk", () => {
    phone();
    const first = screen.getAllByTestId("wh-scanned-card")[0];
    expect(first).toHaveTextContent("Cassé");
    cleanup();

    desk();
    // The desk renders rows in the same order, from the same sort.
    const rows = screen.getAllByTestId("wh-bind-state");
    expect(rows[0]).toHaveAttribute("data-state", "not_registered");
  });

  it("offers the same segments with the same counts", () => {
    phone();
    const phoneSegs = screen.getAllByTestId("wh-scanned-seg").map((s) => s.textContent);
    cleanup();
    desk();
    expect(screen.getAllByTestId("wh-scanned-seg").map((s) => s.textContent)).toEqual(phoneSegs);
  });
});

describe("narrowing the list", () => {
  it("shows only what needs a human when asked", () => {
    phone();
    fireEvent.click(screen.getAllByTestId("wh-scanned-seg").find((s) => s.dataset.key === "check")!);
    const cards = screen.getAllByTestId("wh-scanned-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent("Cassé");
  });

  it("finds a parcel by the number printed on its box", () => {
    phone();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "7700099" } });
    expect(screen.getAllByTestId("wh-scanned-card")).toHaveLength(1);
    expect(screen.getByTestId("wh-scanned-card")).toHaveTextContent("Cassé");
  });

  it("filters by sticker roll, and only offers rolls that are present", () => {
    phone();
    const rolls = screen.getAllByTestId("wh-scanned-roll").map((r) => r.dataset.key);
    expect(rolls).toContain("#d80a0a");
    expect(rolls).toContain("#339307");
    // Seven other Darb colours hold nothing here and are not offered.
    expect(rolls).toHaveLength(3);

    fireEvent.click(screen.getAllByTestId("wh-scanned-roll").find((r) => r.dataset.key === "#339307")!);
    expect(screen.getAllByTestId("wh-scanned-card")).toHaveLength(1);
    expect(screen.getByTestId("wh-scanned-card")).toHaveTextContent("Autre");
  });

  it("says the filters are hiding things, and offers the way back", () => {
    phone();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzzz" } });
    expect(screen.queryByTestId("wh-scanned-card")).not.toBeInTheDocument();
    // Not "aucun colis scanné": the bench has parcels, these filters hide them.
    expect(screen.getByText(/Aucun colis pour ces filtres/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("wh-scanned-clear"));
    expect(screen.getAllByTestId("wh-scanned-card")).toHaveLength(3);
  });

  it("does not offer roll filters where there are no Darb rolls", () => {
    render(<Intl locale="fr"><ScannedList isLy={false} /></Intl>);
    expect(screen.queryByTestId("wh-scanned-roll")).not.toBeInTheDocument();
  });
});
