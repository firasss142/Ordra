import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import fr from "@/messages/fr.json";
import { ToastProvider } from "@/components/ui/Toast";
import type { ProductSheetOverviewResponse } from "@/types/product-overview";

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push, refresh: vi.fn() }),
  usePathname: () => "/fr/products/qr",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { ProductSheetV6 } from "../ProductSheetV6";

const NOW = new Date("2026-10-03T18:00:00Z");
const LY = "00000000-0000-0000-0000-000000000002";
const norm = (s: string | null | undefined) =>
  (s ?? "").replace(/[⁦⁩]/g, "").replace(/[  ]/g, " ");

const PRODUCT = {
  id: "qr",
  market_id: LY,
  name: "القرآن تدبر وعمل",
  sku: "qr-01",
  image_url: null,
  is_active: true,
  default_price: 249,
  current_stock: 943,
  low_stock_threshold: 99,
  unit_cogs: 40,
  packing_cost: 0.5,
  confirmation_processing_cost: 0,
  damaged_return_count: 0,
  initial_stock: 1000,
  agent_brief: null,
  agent_brief_tone: "info",
  agent_composition: null,
  agent_usage: null,
  agent_contraindications: null,
  agent_notes: null,
  description: null,
  product_variants: [],
};

const days = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 8, 4 + i)).toISOString().slice(0, 10));

function sheet(over: Partial<ProductSheetOverviewResponse> = {}): ProductSheetOverviewResponse {
  return {
    period: { from: "2026-09-04", to: "2026-10-03", tz: "Africa/Tripoli", days },
    currency: "LYD",
    lead_days: 14,
    counts: { received: 581, rejected: 370, deleted: 47, cancelled: 0, calling: 5, to_upload: 1, uploaded: 158, delivered: 77, failed: 63, in_flight: 8, withdrawn: 10 },
    confirmation: 158 / 528,
    delivery: 77 / 140,
    provisional: false,
    final: 1 - 14 / 581,
    money: {
      deliveries: 77, paid: 19173, carrier: 1816.269, encaisse: 17356.731, cogs: 3080, packing: 77.8405, processing: 0,
      ads: 10566.192, net: 3632.6985, units: 77, parcels: 155.681, confirmed: 159, carrier_estimated: 0,
    },
    margin: 3632.6985 / 17356.731,
    per_delivery: {
      paid: 19173 / 77, carrier: 1816.269 / 77, encaisse: 17356.731 / 77, cogs: 40, packing: 77.8405 / 77, processing: 0,
      beforeAds: (17356.731 - 3080 - 77.8405) / 77, ads: 10566.192 / 77, net: 3632.6985 / 77,
    },
    break_even: (17356.731 - 3080 - 77.8405) / 77,
    shares: [
      { key: "carrier", share: 1816.269 / 19173, amount: 1816.269 },
      { key: "cogs", share: 3080 / 19173, amount: 3080 },
      { key: "packing", share: 77.84 / 19173, amount: 77.84 },
      { key: "processing", share: 0, amount: 0 },
      { key: "ads", share: 10566.192 / 19173, amount: 10566.192 },
      { key: "profit", share: 3632.6985 / 19173, amount: 3632.6985 },
    ],
    insight: { ads_per_delivery: 10566.192 / 77, ads_share_of_paid: 10566.192 / 19173, other_per_delivery: (1816.269 + 3080 + 77.8405) / 77 },
    why: {
      rejections: [
        { group: "commande_invalide", count: 159 },
        { group: "autre", count: 121 },
        { group: "refus_client", count: 47 },
        { group: "injoignable", count: 43 },
      ],
      failures: [
        { cause: "other", count: 50 },
        { cause: "customer", count: 5 },
        { cause: "noresp", count: 4 },
        { cause: "notneeded", count: 4 },
      ],
    },
    trend: {
      received: [2, 16, 41, 42, 15, 16, 25, 24, 19, 29, 28, 25, 27, 32, 30, 27, 23, 18, 13, 17, 18, 12, 24, 29, 22, 7, 0, 0, 0, 0],
      delivered: [0, 0, 0, 5, 5, 4, 5, 0, 2, 3, 8, 1, 5, 1, 1, 5, 5, 1, 4, 3, 3, 0, 0, 2, 2, 2, 2, 3, 0, 1],
      ads: [10, 725, 481, 477, 378, 424, 360, 430, 376, 499, 439, 389, 404, 426, 440, 343, 491, 389, 433, 381, 419, 389, 401, 470, 480, 110, 0, 0, 0, 0],
      stop_index: 25,
      stop_at: "2026-09-29T15:30:00Z",
    },
    agents: {
      rows: [
        { agent_id: "a1", name: "tasnim", avatar_url: null, assigned: 195, attempts: 371, uploaded: 67, rejected: 119, delivered: 39, failed: 23, in_flight: 1 },
        { agent_id: "a2", name: "salima", avatar_url: null, assigned: 170, attempts: 209, uploaded: 50, rejected: 117, delivered: 19, failed: 25, in_flight: 3 },
      ],
      unassigned: { assigned: 39, uploaded: 1 },
    },
    stock: {
      counted_at: null,
      scanned_30d: 56,
      returned_30d: 0,
      units_left_30d: 158,
      cover: 943 / (158 / 30),
      moves: [{ at: "2026-09-29T14:42:29Z", reason: "scanned", change: -1, balance_after: 943 }],
    },
    last_order_at: "2026-09-29T13:15:00Z",
    avg_delivery_cost: 22.8,
    ...over,
  };
}

let overview: ProductSheetOverviewResponse;
let calls: string[];
function installApi() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.startsWith("/api/products/qr/overview")) return json(overview);
      if (url.startsWith("/api/products/qr")) return json({ data: PRODUCT });
      return new Response("{}", { status: 404 });
    }),
  );
}

function renderSheet(role: "super_admin" | "market_manager" | "warehouse_agent" = "super_admin") {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli" now={NOW}>
        <ToastProvider>
          <ProductSheetV6 productId="qr" role={role} locale="fr" />
        </ToastProvider>
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  nav.search = "";
  overview = sheet();
  installApi();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const text = (sel: string) => norm(document.querySelector(sel)?.textContent);
/** Matches the element whose text, isolates and no-break spaces normalised, is exactly `want`. */
const byNorm = (want: string) => (_: string, el: Element | null) =>
  !!el && norm(el.textContent) === want && Array.from(el.children).every((c) => norm(c.textContent) !== want);
const FLOW_TITLE = byNorm("Ce que sont devenues les 581 commandes");

describe("ProductSheetV6 — the approved product sheet", () => {
  test("until the product AND its figures arrive, one skeleton — never the hero alone over « Chargement… »", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } });
        if (url.startsWith("/api/products/qr/overview")) {
          await gate;
          return json(overview);
        }
        if (url.startsWith("/api/products/qr")) return json({ data: PRODUCT });
        return new Response("{}", { status: 404 });
      }),
    );
    const { container } = renderSheet();
    // let the product request settle while the figures are still held back
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".empty-q")).toBeNull();
    expect(container.querySelectorAll(".hero")).toHaveLength(1);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    release();
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("the hero names the product, its state, SKU, price and last order", async () => {
    renderSheet();
    await screen.findByRole("heading", { level: 1, name: "القرآن تدبر وعمل" });
    const hero = text(".hero");
    expect(hero).toContain("Actif");
    expect(hero).toContain("qr-01");
    expect(hero).toContain("249 د.ل · prix catalogue");
    expect(hero).toContain("Dernière commande : mar. 29 sept., 15:15");
  });

  test("the period says how final the figures are", async () => {
    renderSheet();
    await screen.findByText(FLOW_TITLE);
    expect(text(".pbar2")).toContain("Résultat définitif : 98 %");
    expect(screen.getByRole("button", { name: "30 jours" })).toHaveAttribute("aria-pressed", "true");
  });

  test("five KPIs on the cohort", async () => {
    renderSheet();
    await screen.findByText(FLOW_TITLE);
    const k = text(".kpis");
    expect(k).toContain("Commandes reçues581");
    expect(k).toContain("du 4 sept. au 3 oct.");
    expect(k).toContain("30 %");
    expect(k).toContain("158 uploadées · 370 rejetées");
    expect(k).toContain("55 %");
    expect(k).toContain("77 livrées · 63 échouées · 8 en route");
    expect(k).toContain("Encaissé17 357 د.ل");
    expect(k).toContain("Payé 19 173 د.ل · Darb −1 816 د.ل");
    expect(k).toContain("+3 633 د.ل");
    expect(k).toContain("Marge 21 % · +47,2 د.ل par livraison");
  });

  test("the outcome flow and why orders are lost", async () => {
    renderSheet();
    await screen.findByText(FLOW_TITLE);
    const flow = text(".flowwrap");
    for (const label of ["Reçues", "Uploadées", "Rejetées", "Supprimées", "Livrées", "Échouées", "Chez Darb", "Annulées avant envoi"]) {
      expect(flow).toContain(label);
    }
    const why = text(".why");
    expect(why).toContain("Commande non réelle159");
    expect(why).toContain("Sans raison donnée par Darb50");
    expect(why).toContain("Un colis échoué ne coûte rien chez Darb et revient à l’entrepôt.");
  });

  test("where 100 د.ل go: the ledger, per period and per delivery, and the two sentences", async () => {
    renderSheet();
    await screen.findByText("Où vont 100 د.ل payés par les clients");
    const ledger = text(".ledger");
    expect(ledger).toContain("Payé par les clients19 173 د.ل249,0 د.ل");
    expect(ledger).toContain("Frais Darb (factures)−1 816 د.ل−23,6 د.ل");
    expect(ledger).toContain("Encaissé17 357 د.ل225,4 د.ل");
    expect(ledger).toContain("Emballage156 colis × 0,5−78 د.ل−1,0 د.ل");
    expect(ledger).toContain("Profit net+3 633 د.ل+47,2 د.ل");
    const ins = text(".insights");
    expect(ins).toContain("La pub coûte 137,2 د.ل par livraison, soit 55 % de ce que paie le client.");
    expect(ins).toContain("C’est plus que le produit, Darb et l’emballage réunis (64,6 د.ل).");
    expect(ins).toContain("Point mort : la pub peut monter jusqu’à 184,4 د.ل par livraison");
  });

  test("day by day stops where intake stopped", async () => {
    renderSheet();
    await screen.findByText("Jour par jour");
    expect(screen.getByText("Plus rien depuis le 29 sept.")).toBeInTheDocument();
  });

  test("agents in Salle de contrôle's vocabulary, the unassigned apart", async () => {
    renderSheet();
    await screen.findByText("Agents");
    const table = document.querySelector(".atbl") as HTMLElement;
    const tasnim = within(table).getByText("tasnim").closest("tr") as HTMLElement;
    expect(norm(tasnim.textContent)).toContain("19537167119");
    expect(within(table).getByText("Sans agent")).toBeInTheDocument();
  });

  test("stock: never counted, said plainly, with the pace", async () => {
    renderSheet();
    await screen.findByText("Jamais compté");
    const card = text(".two");
    expect(card).toContain("943");
    expect(card).toContain("158 colis sont partis en 30 jours, 56 ont été scannés en sortie, et aucun retour n’a été scanné.");
    expect(card).toContain("≈ 179 jours");
    expect(card).toContain("Sortie scannée");
    expect(card).toContain("Stock initial");
  });

  test("an empty agent sheet invites writing it", async () => {
    renderSheet();
    await screen.findByText("Les agents ne voient rien sur ce produit pendant l’appel");
    expect(screen.getByRole("link", { name: /Écrire la fiche/ })).toHaveAttribute("href", "/fr/products/qr/edit?tab=fiche");
  });

  test("a warehouse agent sees the product and its stock, never the money", async () => {
    renderSheet("warehouse_agent");
    await screen.findByRole("heading", { level: 1, name: "القرآن تدبر وعمل" });
    expect(calls.some((c) => c.includes("/overview"))).toBe(false);
    expect(document.querySelector(".kpis")).toBeNull();
    expect(screen.getByText("Jamais compté")).toBeInTheDocument();
  });

  test("a product without orders in the period says so", async () => {
    overview = sheet({ counts: { ...sheet().counts, received: 0 }, money: { ...sheet().money, paid: 0, deliveries: 0 } });
    renderSheet();
    await screen.findByText("Aucune commande sur la période");
    expect(document.querySelector(".kpis")).toBeNull();
  });
});
