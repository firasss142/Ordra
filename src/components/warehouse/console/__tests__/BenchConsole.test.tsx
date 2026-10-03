import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/messages/fr.json";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import type { OrderZone } from "@/lib/warehouse/zone-index";
import { BenchConsole } from "../BenchConsole";
import { DeskScanProvider, useDeskScan } from "@/components/warehouse/desk/DeskScanContext";

/**
 * Desk Sortir — the head and its two tabs.
 *
 * « Sortir » and, at the end of the head, « À scanner N » | « Sortis
 * aujourd'hui N ». The first is the roll table, the second the scanned list.
 * The pickup strip lives on Aujourd'hui; it is not repeated here.
 */

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock("../ScannedTable", () => ({
  ScannedTable: ({ warehouseId }: { warehouseId?: string | null }) => (
    <div data-testid="scanned-table" data-warehouse={warehouseId ?? ""} />
  ),
}));

vi.mock("@/components/warehouse/pickup/PickupSwitch", () => ({
  PickupSwitch: () => <div data-testid="pickup-switch" />,
}));

let page: Record<string, unknown> | undefined;
const swrKeys: string[] = [];
vi.mock("swr", () => ({
  default: (key: string, _f: unknown, opts: { fallbackData?: unknown }) => {
    swrKeys.push(key);
    return { data: page ?? opts?.fallbackData, error: undefined, isLoading: false, mutate: vi.fn() };
  },
}));

const GREEN: OrderZone = {
  branchGroup: "BN", colorHex: "#339307", colourFr: "Vert",
  nameFr: "Région orientale", nameAr: "المنطقة الشرقية", source: "carrier",
};

function row(id: string): WarehouseOrderRow & { zone: OrderZone } {
  return {
    id,
    customer_name: "Meryem",
    customer_phone: "+218",
    customer_city: "Derna",
    customer_area: null,
    customer_address: null,
    product_id: "p1",
    product_name: "Coran",
    variant_label: null,
    quantity: 1,
    total_price: 120,
    status: "uploaded",
    created_at: new Date().toISOString(),
    uploaded_at: new Date().toISOString(),
    branch_group: "BN",
    tracking_number: "SH1",
    carrier_sticker_ref: null,
    carrier_status_slug: null,
    has_carrier_ref: true,
    current_stock: 9,
    low_stock_threshold: 1,
    zone: GREEN,
  } as WarehouseOrderRow & { zone: OrderZone };
}

let ctx: ReturnType<typeof useDeskScan> | null = null;
function Probe() {
  ctx = useDeskScan();
  return null;
}

function renderBench(props: Partial<Parameters<typeof BenchConsole>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <DeskScanProvider>
        <BenchConsole
          market="ly"
          initialOrders={[row("a1")]}
          initialTotal={47}
          scannedToday={14}
          warehouseId={null}
          siteNames={{}}
          fold={{ total: 0, parts: [] }}
          {...props}
        />
        <Probe />
      </DeskScanProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  page = undefined;
  swrKeys.length = 0;
  ctx = null;
});
afterEach(cleanup);

describe("Sortir — the head", () => {
  it("is titled « Sortir » with the two tabs and their counts", () => {
    page = { orders: [row("a1")], total: 47 };
    renderBench();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sortir");
    const tabs = screen.getAllByRole("tab").map((t) => [t.textContent, t.getAttribute("aria-selected")]);
    expect(tabs).toEqual([
      ["À scanner 47", "true"],
      ["Sortis aujourd'hui 14", "false"],
    ]);
  });

  it("counts the whole queue, not the page of rows it holds", () => {
    page = { orders: [row("a1")], total: 312 };
    renderBench();
    expect(screen.getAllByRole("tab")[0].textContent).toBe("À scanner 312");
  });

  it("shows the scanned list on the second tab, for the same building", () => {
    renderBench({ warehouseId: "site-b" });
    fireEvent.click(screen.getByRole("tab", { name: /Sortis aujourd'hui/ }));
    expect(screen.getByTestId("scanned-table").dataset.warehouse).toBe("site-b");
    expect(screen.queryByTestId("wh-desk-parcel")).toBeNull();
  });

  it("does not repeat the pickup strip — it belongs to Aujourd'hui", () => {
    renderBench();
    expect(screen.queryByTestId("pickup-switch")).toBeNull();
  });

  it("reads the queue of the building in the URL", () => {
    renderBench({ warehouseId: "site-b" });
    expect(swrKeys).toContain("/api/warehouse/to-label?limit=200&warehouse_id=site-b");
  });
});

describe("Sortir — the parcel in hand is shared with the top bar", () => {
  it("registers its market and queue for the scan field", () => {
    page = { orders: [row("a1"), row("a2")], total: 2 };
    renderBench();
    expect(ctx?.queue?.market).toBe("ly");
    expect(ctx?.queue?.orders.map((o) => o.id)).toEqual(["a1", "a2"]);
  });

  it("puts the parcel back when it leaves the queue (scanned elsewhere)", () => {
    page = { orders: [row("a1")], total: 1 };
    const view = renderBench();
    fireEvent.click(screen.getByRole("button", { name: "Prendre" }));
    expect(ctx?.hand?.id).toBe("a1");

    page = { orders: [row("a2")], total: 1 };
    view.rerender(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <DeskScanProvider>
          <BenchConsole
            market="ly"
            initialOrders={[]}
            initialTotal={1}
            scannedToday={14}
            warehouseId={null}
            siteNames={{}}
            fold={{ total: 0, parts: [] }}
          />
          <Probe />
        </DeskScanProvider>
      </NextIntlClientProvider>,
    );
    expect(ctx?.hand).toBeNull();
  });

  it("drops the hand and the queue when the page is left", () => {
    page = { orders: [row("a1")], total: 1 };
    const { unmount } = render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <DeskScanProvider>
          <Toggle />
          <Probe />
        </DeskScanProvider>
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Prendre" }));
    expect(ctx?.hand?.id).toBe("a1");
    act(() => {
      fireEvent.click(screen.getByTestId("leave"));
    });
    expect(ctx?.hand).toBeNull();
    expect(ctx?.queue).toBeNull();
    unmount();
  });
});

import { useState } from "react";
function Toggle() {
  const [on, setOn] = useState(true);
  return (
    <>
      <button type="button" data-testid="leave" onClick={() => setOn(false)} />
      {on ? (
        <BenchConsole
          market="ly"
          initialOrders={[row("a1")]}
          initialTotal={1}
          scannedToday={0}
          warehouseId={null}
          siteNames={{}}
          fold={{ total: 0, parts: [] }}
        />
      ) : null}
    </>
  );
}
