import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import frMessages from "@/messages/fr.json";
import { ReceiveDesk } from "../ReceiveDesk";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/fr/warehouse/receive",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/warehouse/receptions/ReceptionSheet", () => ({ ReceptionSheet: () => null }));

/**
 * Recevoir (prototypes/entrepot-desk-v1.html): ordered → arrived → settled.
 * The dock counts blind; the office settles, and a gap that is exactly the
 * damaged units is explained instead of asked.
 */

const po = {
  id: "po1",
  reference: "BC-LY-0006",
  market_id: "m",
  warehouse_id: "B",
  warehouse_name: "Benghazi",
  supplier_id: "s1",
  supplier_name: "SportLine",
  status: "open",
  wanted_by: "2026-10-05",
  ordered_at: "2026-09-24",
  ordered_by_name: null,
  closed_at: null,
  close_reason: null,
  note: null,
  lines: [
    { id: "l1", product_id: "p5", product_name: "Gants de boxe", variant_id: null, variant_label: null, ordered_qty: 120, unit_cost: 17, received_qty: 0, first_received_at: null, outstanding_qty: 120, over_received_qty: 0 },
  ],
  ordered_units: 120,
  received_units: 0,
  outstanding_units: 120,
  over_received_units: 0,
  committed_value: 2040,
  is_late: false,
  days_late: null,
};

const openReception = {
  id: "r1",
  reference: null,
  market_id: "m",
  warehouse_id: "B",
  warehouse_name: "Benghazi",
  warehouse_name_ar: null,
  supplier_name: null,
  supplier_ref: null,
  status: "open",
  expected_at: null,
  note: null,
  photo_url: null,
  arrival_date: "2026-10-05",
  counted_by_name: "Nabil",
  settled_at: null,
  settled_by_name: null,
  supplier_id: null,
  supplier: null,
  invoice_total: null,
  due_at: null,
  discrepancy_reason: null,
  reverses_reception_id: null,
  created_at: "2026-10-05T08:00:00Z",
  is_late: false,
  days_late: null,
  lines: [
    { id: "rl1", product_id: "p5", variant_id: null, product_name: "Gants de boxe", product_sku: null, product_image_url: null, product_stock: 118, variant_label: null, ordered_qty: 120, received_qty: 118, damaged_qty: 2, variance: 0, note: null, unit_cost: null, cogs_current: 15 },
  ],
  totals: { units: 118, damaged: 2, value: null, lines: 1, expected: 120, countedLines: 1 },
  fee_basis: "units",
  costs: [],
  fees_total: 0,
  fees_blocked: null,
  landed_value: null,
  payments: [],
  paid_total: null,
  outstanding: null,
  payment_state: null,
  claim: null,
  can: { recordArrival: true, settle: true, reverse: false, pay: false },
};

const posts: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
beforeEach(() => {
  posts.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string, init?: RequestInit) => {
      const url = String(u);
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
      if (init?.method && init.method !== "GET") {
        posts.push({ url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : {} });
        if (url === "/api/warehouse/arrivals") return json({ reception_id: "r1", ordered: 120, counted: 118 }, 201);
        return json({ ok: true });
      }
      if (url.startsWith("/api/purchases/orders")) return json({ orders: [po] });
      if (url.startsWith("/api/warehouse/receptions")) return json({ receptions: [openReception], currency: "LYD" });
      if (url.startsWith("/api/warehouse/sites"))
        return json({ sites: [{ id: "B", code: "b", name: "بنغازي", nameFr: "Benghazi", isDefault: true, marketId: "m" }, { id: "T", code: "t", name: "طرابلس", nameFr: "Tripoli", isDefault: false, marketId: "m" }] });
      if (url.startsWith("/api/products/search")) return json({ data: [{ id: "p5", name: "Gants de boxe", sku: null, image_url: null }, { id: "p6", name: "Sac de frappe", sku: null, image_url: null }] });
      if (url.startsWith("/api/suppliers")) return json({ suppliers: [{ id: "s1", name: "SportLine" }] });
      return json({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderDesk() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale="fr" messages={frMessages} timeZone="Africa/Tripoli">
        <ReceiveDesk market="ly" marketId="m" role="market_manager" today="2026-10-05" />
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

describe("ReceiveDesk", () => {
  it("reads left to right: on its way, arrived to settle, settled", async () => {
    renderDesk();
    expect(await screen.findByTestId("po-card")).toHaveTextContent("SportLine");
    expect(screen.getByTestId("po-card")).toHaveTextContent("attendue aujourd'hui");
    expect(await screen.findByTestId("open-card")).toHaveTextContent("118 unités en stock");
  });

  it("opens a blind count from an order: its products are picked, never its quantities", async () => {
    renderDesk();
    fireEvent.click(within(await screen.findByTestId("po-card")).getByRole("button", { name: /C'est arrivé/ }));
    const drawer = await screen.findByRole("dialog", { name: "Enregistrer un arrivage" });
    const line = await within(drawer).findByTestId("arrival-line");
    expect(within(line).getByLabelText(/Quantité en bon état/)).toHaveValue("");
    expect(drawer).not.toHaveTextContent("120");
    expect(within(drawer).getByRole("button", { name: /Enregistrer/ })).toBeDisabled();
  });

  it("records one arrival per product, then compares with the order", async () => {
    renderDesk();
    fireEvent.click(within(await screen.findByTestId("po-card")).getByRole("button", { name: /C'est arrivé/ }));
    const drawer = await screen.findByRole("dialog", { name: "Enregistrer un arrivage" });
    const line = await within(drawer).findByTestId("arrival-line");
    fireEvent.change(within(line).getByLabelText(/Quantité en bon état/), { target: { value: "118" } });
    fireEvent.change(within(line).getByLabelText(/abîmés, en plus/), { target: { value: "2" } });
    fireEvent.click(within(drawer).getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Arrivage enregistré" })).toBeInTheDocument());
    expect(posts.filter((p) => p.url === "/api/warehouse/arrivals")).toHaveLength(1);
    expect(posts[0].body).toMatchObject({ product_id: "p5", qty: 118, damaged_qty: 2, warehouse_id: "B" });
    expect(screen.getByTestId("arrival-verdict")).toHaveTextContent("2 abîmés");
  });

  it("explains a gap that is exactly the damaged units, and settles only once the claim is ticked", async () => {
    renderDesk();
    fireEvent.click(await screen.findByTestId("open-card"));
    const drawer = await screen.findByRole("dialog", { name: /Solder l'arrivage/ });
    await within(drawer).findByRole("option", { name: "SportLine" });
    fireEvent.change(within(drawer).getByLabelText("Fournisseur"), { target: { value: "s1" } });
    fireEvent.change(within(drawer).getByLabelText(/Prix unitaire de/), { target: { value: "17" } });
    fireEvent.change(within(drawer).getByLabelText(/Total de la facture/), { target: { value: "2040" } });
    expect(within(drawer).getByTestId("recon")).toHaveTextContent("c'est exactement les 2 abîmés");
    const settle = within(drawer).getByRole("button", { name: /Solder ·/ });
    expect(settle).toBeDisabled();
    fireEvent.click(within(drawer).getByRole("checkbox"));
    expect(settle).toBeEnabled();
    fireEvent.click(settle);
    await waitFor(() => expect(posts.some((p) => p.url.endsWith("/settle"))).toBe(true));
    const body = posts.find((p) => p.url.endsWith("/settle"))!.body;
    expect(body).toMatchObject({ supplier_id: "s1", invoice_total: 2040, discrepancy_reason: "damaged_billed", claim_amount: 34 });
  });
});
