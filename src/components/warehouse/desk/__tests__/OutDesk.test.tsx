import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import frMessages from "@/messages/fr.json";
import type { ToLabelRow } from "@/app/api/warehouse/to-label/route";
import { OutDesk } from "../OutDesk";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/fr/warehouse/out",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/warehouse/QrScanner", () => ({ QrScanner: () => null }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a>,
}));

/**
 * Sortir on the desk (prototypes/entrepot-desk-v1.html): « Prendre » arms the
 * scan bar with the roll to reach for, and a bound sticker takes the next
 * parcel of the same roll.
 */

const RED = "#d80a0a";
const ORANGE = "#fc6401";
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

function row(id: string, over: Partial<ToLabelRow> = {}): ToLabelRow {
  return {
    id,
    customer_name: `client ${id}`,
    customer_phone: "",
    customer_city: "Tripoli",
    customer_address: null,
    product_id: "p1",
    product_name: "Tapis de prière",
    variant_label: null,
    quantity: 1,
    total_price: 190,
    status: "uploaded",
    created_at: hoursAgo(10),
    uploaded_at: hoursAgo(10),
    branch_group: "tripoli",
    customer_area: null,
    tracking_number: null,
    carrier_sticker_ref: null,
    carrier_status_slug: "pending",
    has_carrier_ref: true,
    current_stock: 50,
    low_stock_threshold: 5,
    warehouse_id: "T",
    zone: { branchGroup: "tripoli", colorHex: RED, colourFr: "Rouge", nameFr: null, nameAr: null, source: "directory" },
    ...over,
  } as ToLabelRow;
}

let queue: ToLabelRow[] = [];
const BASE = [
  row("aaaaaaaa-1", { uploaded_at: hoursAgo(80) }),
  row("bbbbbbbb-2", { zone: { branchGroup: "misrata", colorHex: ORANGE, colourFr: "Orange", nameFr: null, nameAr: null, source: "directory" } }),
  row("cccccccc-3", { uploaded_at: hoursAgo(5) }),
];

let scanOk = true;
queue = BASE;
function respond(url: string, init?: RequestInit) {
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (url.startsWith("/api/warehouse/to-label"))
    return json({ orders: queue, total: queue.length, late: 1, scannedToday: 0, carrierWarehouse: 0 });
  if (url.startsWith("/api/warehouse/scanned")) return json({ orders: [] });
  if (url.startsWith("/api/warehouse/sites"))
    return json({ sites: [{ id: "T", code: "tripoli", name: "Tripoli", isDefault: true, marketId: "m" }], mine: null, pinned: false, unassigned: false });
  if (url.startsWith("/api/warehouse/pickup")) return json({ sites: [] });
  if (url.startsWith("/api/warehouse/scan-out") && init?.method === "POST")
    return scanOk ? json({ stock_after: 49, sticker_bind_state: "confirmed" }) : json({ error: "refusé", message: "refusé" }, 409);
  return json({});
}

beforeEach(() => {
  scanOk = true;
  queue = BASE;
  vi.stubGlobal("fetch", vi.fn(async (u: string, i?: RequestInit) => respond(String(u), i)));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderOut() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale="fr" messages={frMessages} timeZone="Africa/Tripoli">
        <OutDesk market="ly" dateLabel="dimanche 5 octobre" today="2026-10-05" initialOrders={queue} initialSiteId={null} />
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

describe("OutDesk", () => {
  it("lists the bench oldest first, with its roll written beside the dot", () => {
    renderOut();
    const rows = screen.getAllByTestId("out-row");
    expect(rows[0]).toHaveTextContent("client aaaaaaaa-1");
    expect(within(rows[0]).getByText("Rouge")).toBeInTheDocument();
  });

  it("arms the scan bar with the roll to reach for when a parcel is taken", () => {
    renderOut();
    fireEvent.click(within(screen.getAllByTestId("out-row")[0]).getByRole("button", { name: /Prendre/ }));
    expect(screen.getByText(/Colis en main/)).toBeInTheDocument();
    expect(screen.getByText(/Collez un sticker/)).toHaveTextContent("Rouge");
  });

  it("takes the next parcel of the same roll once the sticker is bound", async () => {
    renderOut();
    fireEvent.click(within(screen.getAllByTestId("out-row")[0]).getByRole("button", { name: /Prendre/ }));
    const field = screen.getByLabelText("Numéro du sticker");
    fireEvent.change(field, { target: { value: "4471" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/4471/));
    // The next RED parcel, not the orange one in between.
    expect(screen.getByText(/Colis en main/).closest(".scanbar")).toHaveTextContent("client cccccccc-3");
  });

  it("says why a scan was refused and keeps the parcel in hand", async () => {
    scanOk = false;
    renderOut();
    fireEvent.click(within(screen.getAllByTestId("out-row")[0]).getByRole("button", { name: /Prendre/ }));
    const field = screen.getByLabelText("Numéro du sticker");
    fireEvent.change(field, { target: { value: "4471" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/refusé/));
    expect(screen.getByText(/Colis en main/).closest(".scanbar")).toHaveTextContent("client aaaaaaaa-1");
  });

  it("filters to the late parcels from their tile", () => {
    renderOut();
    fireEvent.click(screen.getByRole("button", { name: /En attente depuis \+ 2 jours/ }));
    expect(screen.getAllByTestId("out-row")).toHaveLength(1);
  });

  it("shows 25 parcels a page and goes back to the first page when the filter changes", async () => {
    queue = Array.from({ length: 30 }, (_, i) => row(`p${String(i).padStart(7, "0")}-x`, { uploaded_at: hoursAgo(100 - i) }));
    renderOut();
    expect(screen.getAllByTestId("out-row")).toHaveLength(25);
    expect(screen.getByTestId("pager")).toHaveTextContent("1–25 sur 30");
    fireEvent.click(screen.getByRole("button", { name: /Page suivante/ }));
    expect(screen.getAllByTestId("out-row")).toHaveLength(5);
    expect(screen.getByTestId("pager")).toHaveTextContent("26–30 sur 30");
    fireEvent.click(screen.getByRole("button", { name: /En attente depuis \+ 2 jours/ }));
    expect(screen.getByTestId("pager")).toHaveTextContent("1–25");
  });

  it("hides the pager when everything fits on one page", () => {
    renderOut();
    expect(screen.queryByTestId("pager")).not.toBeInTheDocument();
  });

  it("opens the scan run from « Commencer une tournée », on the chosen roll", () => {
    renderOut();
    expect(screen.getByRole("link", { name: /Commencer une tournée/ })).toHaveAttribute("href", "/fr/warehouse/scan");
    fireEvent.click(screen.getByRole("button", { name: /Rouge/ }));
    expect(screen.getByRole("link", { name: /Tournée Rouge/ }).getAttribute("href")).toBe(
      `/fr/warehouse/scan?roll=${encodeURIComponent(RED)}`,
    );
  });
});
