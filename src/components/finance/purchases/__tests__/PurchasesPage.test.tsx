import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import fr from "@/messages/fr.json";
import { buildPurchasesView, type PurchasesInput } from "@/lib/finance/purchases/model";

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/fr/finance/purchases",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { PurchasesPage } from "../PurchasesPage";

const LY = "00000000-0000-0000-0000-000000000002";

const input: PurchasesInput = {
  today: "2026-10-04",
  warehouses: [
    { id: "w-tri", name: "Tripoli", isDefault: true },
    { id: "w-bgz", name: "Benghazi" },
  ],
  suppliers: [
    { id: "s-nour", name: "Imprimerie Al-Nour", category: "Livres", city: "Tripoli", isActive: true },
    { id: "s-dak", name: "Dar Al-Kitab", category: "Livres", city: "Benghazi", isActive: true },
  ],
  receptions: [
    {
      id: "r-31", reference: "REC-LY-2026-0031", status: "settled", warehouseId: "w-tri", arrivalDate: "2026-09-12", createdAt: "2026-09-12T08:00:00Z",
      settledAt: "2026-09-12T10:00:00Z", countedBy: null, supplierId: "s-nour", supplierName: null, supplierRef: null, invoiceTotal: 18600,
      dueAt: "2026-09-22", feeBasis: "value", payments: [{ amount: 14400 }], costs: [],
      lines: [{ id: "l-31", productId: "p-tad", name: "Tadabbur", variant: null, received: 300, damaged: 0, unitCost: 62 }],
    },
    {
      id: "r-34", reference: "REC-LY-2026-0034", status: "settled", warehouseId: "w-bgz", arrivalDate: "2026-09-28", createdAt: "2026-09-28T08:00:00Z",
      settledAt: "2026-09-28T10:00:00Z", countedBy: null, supplierId: "s-dak", supplierName: null, supplierRef: null, invoiceTotal: 7626,
      dueAt: "2026-10-22", feeBasis: "value", payments: [{ amount: 2980 }], costs: [],
      lines: [{ id: "l-34", productId: "p-mal", name: "Le mal et le remède", variant: null, received: 180, damaged: 6, unitCost: 41 }],
    },
    {
      id: "r-open", reference: null, status: "open", warehouseId: "w-bgz", arrivalDate: "2026-09-29", createdAt: "2026-09-29T15:05:00Z",
      settledAt: null, countedBy: "Adel", supplierId: null, supplierName: null, supplierRef: null, invoiceTotal: null, dueAt: null,
      feeBasis: "value", payments: [], costs: [{ id: "c-1", kind: "freight", amount: 60 }],
      lines: [{ id: "lo-1", productId: "p-cor", name: "Coran couleurs", variant: null, received: 28, damaged: 2, unitCost: 70 }],
    },
  ],
  claims: [{ id: "cl-1", supplierId: "s-dak", receptionId: "r-34", kind: "damaged", amount: 246, units: 6, status: "open", openedAt: "2026-09-28T11:00:00Z" }],
  orders: [
    {
      id: "po-15", reference: "BC-LY-2026-0015", market_id: LY, warehouse_id: "w-bgz", warehouse_name: null, supplier_id: "s-dak", supplier_name: null,
      status: "open", wanted_by: "2026-10-10", ordered_at: "2026-09-20T08:00:00Z", ordered_by_name: null, closed_at: null, close_reason: null, note: null,
      lines: [{ id: "pol-15", product_id: "p-mal", product_name: "Le mal et le remède", variant_id: null, variant_label: null, ordered_qty: 300, unit_cost: 41, received_qty: 186, first_received_at: "2026-09-28T08:00:00Z" }],
    },
  ],
  links: [],
  products: [
    { id: "p-tad", name: "Tadabbur" },
    { id: "p-mal", name: "Le mal et le remède" },
  ],
  suggestions: [{ productId: "p-tad", name: "Tadabbur", siteId: "w-bgz", qty: 250, value: 15500, days: 17 }],
};

type Call = { url: string; method: string; body: unknown };
const calls: Call[] = [];
const responses: Record<string, unknown> = {};

beforeEach(() => {
  nav.search = "";
  calls.length = 0;
  for (const k of Object.keys(responses)) delete responses[k];
  window.history.replaceState(null, "", "/fr/finance/purchases");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (method === "GET" && url.startsWith("/api/finance/purchases")) {
      return new Response(JSON.stringify({ ...buildPurchasesView(input), marketId: LY, currency: "LYD" }), { status: 200 });
    }
    const key = `${method} ${url}`;
    return new Response(JSON.stringify(responses[key] ?? { ok: true }), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const norm = (s: string | null | undefined) => (s ?? "").replace(/[⁦⁩]/g, "").replace(/[\s  ]+/g, " ").trim();
const writes = () => calls.filter((c) => c.method !== "GET");

function mount(marketId: string | null = LY) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <PurchasesPage marketId={marketId} marketName="Libye" locale="fr" />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

async function ready() {
  await waitFor(() => expect(document.querySelector(".wts")).toBeTruthy());
}

describe("Achats — the work tiles", () => {
  test("count what I owe, what waits to be settled, what is on order, and the suppliers", async () => {
    mount();
    await ready();
    const tile = (name: RegExp) => [...screen.getByRole("button", { name }).querySelectorAll(".wt-t > *")].map((e) => norm(e.textContent));
    expect(tile(/À payer/)).toEqual(["8 600د.ل", "À payer", "dont 4 200 en retard"]);
    expect(tile(/À solder/)).toEqual(["1arrivage", "À solder", "reçus au quai, pas encore chiffrés"]);
    expect(tile(/En commande/)).toEqual(["1bon", "En commande", "1 voulu cette semaine"]);
    expect(tile(/Fournisseurs/)).toEqual(["2", "Fournisseurs", "1 litige ouvert"]);
  });

  test("asks for a market when none is chosen", () => {
    mount(null);
    expect(screen.getByText("Choisissez un marché")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});

describe("À payer", () => {
  test("is the default: the due strip, then one row per bill with Payer", async () => {
    mount();
    await ready();
    const strip = screen.getByRole("group", { name: "Échéances" });
    expect(within(strip).getAllByRole("button").map((b) => norm(b.querySelector("span")?.textContent))).toEqual(["En retard", "Cette semaine", "Plus tard"]);
    const rows = document.querySelectorAll(".rw.bill");
    expect(rows).toHaveLength(2);
    expect(norm(rows[0].querySelector(".who .l1")?.textContent)).toBe("Imprimerie Al-Nour");
    expect(norm(rows[0].querySelector(".pill")?.textContent)).toBe("12 j de retard");
    expect(norm(rows[1].querySelector(".tg.warn")?.textContent)).toBe("246 retenus · litige ouvert");
    expect(norm(rows[1].querySelector(".left b")?.textContent)).toBe("4 400د.ل");
  });

  test("a due segment dims the other bills", async () => {
    mount();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /^En retard/ }));
    const rows = document.querySelectorAll(".rw.bill");
    expect(rows[0].classList.contains("dim")).toBe(false);
    expect(rows[1].classList.contains("dim")).toBe(true);
  });

  test("Payer opens a drawer pre-filled with the rest, and records the payment on the reception", async () => {
    mount();
    await ready();
    fireEvent.click(within(document.querySelectorAll(".rw.bill")[0] as HTMLElement).getByRole("button", { name: /Payer/ }));
    const dlg = await screen.findByRole("dialog", { name: "Payer Imprimerie Al-Nour" });
    expect((within(dlg).getByLabelText("Montant") as HTMLInputElement).value).toBe("4200");
    expect(norm(dlg.querySelector(".recap")?.textContent)).toBe("Après ce paiement : plus rien dû à Imprimerie Al-Nour.");
    fireEvent.click(within(dlg).getByRole("radio", { name: /Virement/ }));
    fireEvent.click(within(dlg).getByRole("button", { name: /Enregistrer le paiement/ }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      url: "/api/warehouse/receptions/r-31/payments",
      method: "POST",
      body: { amount: 4200, paid_at: "2026-10-04", method: "bank_transfer", note: null },
    });
  });
});

describe("À solder", () => {
  test("opens from its tile and from ?tile=settle", async () => {
    nav.search = "tile=settle";
    mount();
    await ready();
    expect(screen.getByRole("heading", { name: "À solder" })).toBeTruthy();
    expect(norm(document.querySelector(".rw.arr .what b")?.textContent)).toBe("Coran couleurs ×28");
  });

  test("the drawer explains a gap by the damage, claims it, and settles through the existing routes", async () => {
    nav.search = "tile=settle";
    responses["POST /api/warehouse/receptions/r-open/settle"] = { reference: "REC-LY-2026-0035" };
    mount();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /Solder/ }));
    const dlg = await screen.findByRole("dialog", { name: "Solder l'arrivage" });
    fireEvent.change(within(dlg).getByLabelText("Fournisseur"), { target: { value: "s-dak" } });
    fireEvent.change(within(dlg).getByLabelText("N° de facture"), { target: { value: "F-901" } });
    fireEvent.change(within(dlg).getByLabelText(/Facture totale/), { target: { value: "2100" } });
    expect(norm(dlg.querySelector(".rec-why")?.textContent)).toBe("2 abîmés × leur prix = 140 — exactement l'écart : la facture compte la casse.");
    fireEvent.click(within(dlg).getByRole("button", { name: /^Solder$/ }));
    await waitFor(() => expect(writes().map((w) => `${w.method} ${w.url}`)).toContain("POST /api/warehouse/receptions/r-open/settle"));
    expect(writes()[0]).toEqual({ url: "/api/warehouse/receptions/r-open", method: "PATCH", body: { supplier_ref: "F-901", lines: [{ id: "lo-1", unit_cost: 70 }] } });
    const settle = writes().find((w) => w.url.endsWith("/settle"))!;
    expect(settle.body).toEqual({ supplier_id: "s-dak", invoice_total: 2100, due_at: "2026-11-03", discrepancy_reason: "2 abîmés facturés", claim_amount: 140 });
  });
});

describe("En commande", () => {
  test("one card per open order with its progress", async () => {
    nav.search = "tile=po";
    mount();
    await ready();
    const card = document.querySelector(".po")!;
    expect(norm(card.querySelector(".prog small")?.textContent)).toBe("reçu 186 sur 300");
    expect(norm(card.querySelector(".pill")?.textContent)).toBe("Reçu partiellement");
  });

  test("a link from Stock opens a pre-filled order, and creating it goes through /api/purchases/orders", async () => {
    nav.search = "new=po&site=w-bgz&product=p-tad&qty=150";
    responses["POST /api/purchases/orders"] = { reference: "BC-LY-2026-0016" };
    mount();
    await ready();
    const dlg = await screen.findByRole("dialog", { name: "Nouveau bon de commande" });
    expect(screen.getByRole("heading", { name: "En commande" })).toBeTruthy();
    expect((within(dlg).getByLabelText("Produit 1") as HTMLSelectElement).value).toBe("p-tad");
    expect((within(dlg).getByLabelText("Qté 1") as HTMLInputElement).value).toBe("150");
    expect((within(dlg).getByLabelText("Prix unit. 1") as HTMLInputElement).value).toBe("62");
    expect((within(dlg).getByLabelText("Fournisseur") as HTMLSelectElement).value).toBe("s-nour");
    expect(within(dlg).getByRole("radio", { name: "Benghazi" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(dlg).getByRole("button", { name: /Créer le bon/ }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      url: "/api/purchases/orders",
      method: "POST",
      body: { supplier_id: "s-nour", warehouse_id: "w-bgz", wanted_by: null, lines: [{ product_id: "p-tad", variant_id: null, qty: 150, unit_cost: 62 }] },
    });
  });
});

describe("Fournisseurs", () => {
  test("one card each, and an open claim resolved by a credit note needs its reference", async () => {
    nav.search = "tile=sup";
    mount();
    await ready();
    const dak = screen.getByRole("heading", { name: "Dar Al-Kitab" }).closest("article")!;
    expect(norm(dak.querySelector(".lit b")?.textContent)).toBe("1 litige · 246 retenus");
    fireEvent.click(within(dak as HTMLElement).getByRole("button", { name: /Résoudre/ }));
    fireEvent.click(within(dak as HTMLElement).getByRole("button", { name: /Avoir reçu/ }));
    fireEvent.change(within(dak as HTMLElement).getByLabelText("Référence de l'avoir"), { target: { value: "AV-12" } });
    fireEvent.click(within(dak as HTMLElement).getByRole("button", { name: "Confirmer" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ url: "/api/purchases/claims/cl-1/resolve", method: "POST", body: { outcome: "credited", credit_ref: "AV-12" } });
  });

  test("+ Fournisseur creates one in this market", async () => {
    mount();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /^Fournisseur$/ }));
    const dlg = await screen.findByRole("dialog", { name: "Nouveau fournisseur" });
    fireEvent.change(within(dlg).getByLabelText("Nom"), { target: { value: "Cartons Libya" } });
    fireEvent.change(within(dlg).getByLabelText("Ville ou pays"), { target: { value: "Tripoli" } });
    fireEvent.click(within(dlg).getByRole("button", { name: /Ajouter le fournisseur/ }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ url: "/api/suppliers", method: "POST", body: { market_id: LY, name: "Cartons Libya", city: "Tripoli", phone: "", category: "", note: "" } });
  });
});
