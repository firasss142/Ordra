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
let labels: Record<string, unknown> = { enabled: false, toPrint: [], printed: {}, lastBatch: null };
let labelCalls: Array<{ method: string; body: unknown }> = [];
let labelPrintOk = true;
function respond(url: string, init?: RequestInit) {
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (url.startsWith("/api/warehouse/to-label"))
    return json({ orders: queue, total: queue.length, late: 1, scannedToday: 0, carrierWarehouse: 0 });
  if (url.startsWith("/api/warehouse/scanned")) return json({ orders: [] });
  if (url.startsWith("/api/warehouse/sites"))
    return json({ sites: [{ id: "T", code: "tripoli", name: "Tripoli", isDefault: true, marketId: "m" }], mine: null, pinned: false, unassigned: false });
  if (url.startsWith("/api/warehouse/pickup")) return json({ sites: [] });
  if (url.startsWith("/api/warehouse/xdelivery-labels")) {
    labelCalls.push({ method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    if (init?.method === "POST")
      return labelPrintOk
        ? new Response(new Blob(["%PDF-1.4"], { type: "application/pdf" }), { status: 200, headers: { "Content-Type": "application/pdf" } })
        : json({ error: "db_error" }, 500);
    return json(labels);
  }
  if (url.startsWith("/api/warehouse/scan-out") && init?.method === "POST")
    return scanOk ? json({ stock_after: 49, sticker_bind_state: "confirmed" }) : json({ error: "refusé", message: "refusé" }, 409);
  return json({});
}

beforeEach(() => {
  scanOk = true;
  queue = BASE;
  labels = { enabled: false, toPrint: [], printed: {}, lastBatch: null };
  labelCalls = [];
  labelPrintOk = true;
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

describe("OutDesk — X-Delivery labels (prototypes/xdelivery-label-v1.html, screen 3)", () => {
  const XD1 = "xxxxxxxx-0001";
  const XD2 = "xxxxxxxx-0002";
  const tn = (id: string, over: Partial<ToLabelRow> = {}) =>
    row(id, { customer_city: "Sousse", zone: { branchGroup: null, colorHex: null, colourFr: null, nameFr: null, nameAr: null, source: "unknown" }, ...over });

  let opened: { location: { href: string }; close: () => void } | null;
  beforeEach(() => {
    queue = [tn(XD1, { tracking_number: "611791217700001" }), tn(XD2, { tracking_number: "611791217700002" }), tn("navex-03")];
    labels = {
      enabled: true,
      toPrint: [XD1],
      printed: { [XD2]: "2026-10-06T08:12:00Z" },
      lastBatch: { at: "2026-10-06T08:12:00Z", count: 14, orderIds: [XD2] },
    };
    opened = { location: { href: "" }, close: vi.fn() };
    vi.stubGlobal("open", vi.fn(() => opened));
    URL.createObjectURL = vi.fn(() => "blob:pdf");
    try { localStorage.clear(); } catch { /* private mode */ }
  });

  function renderTn() {
    return render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <NextIntlClientProvider locale="fr" messages={frMessages} timeZone="Africa/Tunis">
          <OutDesk market="tn" dateLabel="mardi 6 octobre" today="2026-10-06" initialOrders={queue} initialSiteId={null} />
        </NextIntlClientProvider>
      </SWRConfig>,
    );
  }
  const rowOf = (text: string) => screen.getAllByTestId("out-row").find((r) => r.textContent?.includes(text))!;

  it("says how many labels wait, and each X-Delivery row says its own", async () => {
    renderTn();
    expect(await screen.findByTestId("xd-labels")).toHaveTextContent("1 étiquette à imprimer");
    expect(within(rowOf(`client ${XD1}`)).getByText("À imprimer")).toBeInTheDocument();
    expect(within(rowOf(`client ${XD2}`)).getByText("Imprimée 09:12")).toBeInTheDocument();
    // Not an X-Delivery parcel: no label state of ours to show.
    expect(within(rowOf("client navex-03")).queryByText(/imprim/i)).toBeNull();
  });

  it("names the last batch", async () => {
    renderTn();
    expect(await screen.findByText(/Dernière impression : 09:12 · 14 étiquettes/)).toBeInTheDocument();
  });

  it("« Imprimer » sends the waiting labels in A4 ×2 by default and opens the PDF", async () => {
    renderTn();
    fireEvent.click(await screen.findByRole("button", { name: "Imprimer l'étiquette" }));
    await waitFor(() => expect(opened?.location.href).toBe("blob:pdf"));
    expect(labelCalls.find((c) => c.method === "POST")?.body).toEqual({ format: "a4x2" });
  });

  it("the thermal choice is sent, and remembered by this computer", async () => {
    const first = renderTn();
    fireEvent.click(await screen.findByRole("radio", { name: "10×15" }));
    fireEvent.click(screen.getByRole("button", { name: "Imprimer l'étiquette" }));
    await waitFor(() => expect(labelCalls.some((c) => c.method === "POST")).toBe(true));
    expect(labelCalls.find((c) => c.method === "POST")?.body).toEqual({ format: "thermal" });
    first.unmount();
    renderTn();
    expect(await screen.findByRole("radio", { name: "10×15" })).toHaveAttribute("aria-checked", "true");
  });

  it("a lost label is reprinted from its row", async () => {
    renderTn();
    fireEvent.click(await within(rowOf(`client ${XD2}`)).findByRole("button", { name: "Réimprimer" }));
    await waitFor(() => expect(labelCalls.some((c) => c.method === "POST")).toBe(true));
    expect(labelCalls.find((c) => c.method === "POST")?.body).toEqual({ format: "a4x2", order_ids: [XD2] });
  });

  it("a failed print says so and closes the empty tab", async () => {
    labelPrintOk = false;
    renderTn();
    fireEvent.click(await screen.findByRole("button", { name: "Imprimer l'étiquette" }));
    expect(await screen.findByText("Impression impossible. Réessayez.")).toBeInTheDocument();
    expect(opened?.close).toHaveBeenCalled();
  });

  it("no X-Delivery account: no pill, no label column", async () => {
    labels = { enabled: false, toPrint: [], printed: {}, lastBatch: null };
    renderTn();
    await waitFor(() => expect(labelCalls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId("xd-labels")).toBeNull();
    expect(screen.queryByText("Étiquette")).toBeNull();
  });

  it("Libya never asks for X-Delivery labels", async () => {
    queue = BASE;
    renderOut();
    await screen.findAllByTestId("out-row");
    expect(labelCalls).toEqual([]);
  });
});
