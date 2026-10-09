import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import fr from "@/messages/fr.json";
import { buildDrill, buildView, type BuildInput } from "@/lib/performance/orders/build";
import { resolveWindow } from "@/lib/performance/orders/period";
import { parseState } from "@/lib/performance/orders/query";
import type { Bk, PerfOrder } from "@/lib/performance/orders/facts";

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/fr/performance/orders",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { PerformanceOrders } from "../PerformanceOrders";

const LY = "00000000-0000-0000-0000-000000000002";
const TAD = "11111111-1111-4111-8111-111111111111";
const DAA = "22222222-2222-4222-8222-222222222222";
const AMINA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SARA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TODAY = "2026-10-04";
const FIRST = "2026-06-07";

let seq = 0;
function o(bk: Bk, x: Partial<PerfOrder> = {}): PerfOrder {
  seq += 1;
  return {
    id: `o${seq}`, ref: String(1000 + seq), at: "2026-09-20T10:00:00Z", day: "2026-09-20", status: "x", bk,
    agent: AMINA, reason: null, sub: null, cause: null, price: 100, city: null,
    lines: [{ p: TAD, v: [], share: 1 }], ...x,
  };
}
const n = (k: number, bk: Bk, x: Partial<PerfOrder> = {}) => Array.from({ length: k }, () => o(bk, x));
const A = [
  ...n(30, "d"), ...n(10, "f"), ...n(20, "x", { reason: "autre" }),
  ...n(35, "d", { agent: SARA, lines: [{ p: DAA, v: [], share: 1 }] }), ...n(5, "f", { agent: SARA, lines: [{ p: DAA, v: [], share: 1 }] }),
];
const P = n(60, "d", { day: "2026-08-20", at: "2026-08-20T10:00:00Z" });

function input(qs: URLSearchParams, owner: boolean): BuildInput {
  const state = parseState(qs);
  return {
    state, today: TODAY, first: FIRST, currency: "LYD", window: resolveWindow(state.period, state.from, state.to, TODAY, FIRST),
    A, P, Bd: null, ads: { "2026-09-20": 500 }, withMoney: owner,
    catalogue: [
      { id: TAD, name: "Coran · Tadabbur", image: null, sizes: [] },
      { id: DAA, name: "Le mal et le remède", image: null, sizes: [] },
    ],
    agents: [
      { id: AMINA, name: "Amina", color: "indigo", avatar: null },
      { id: SARA, name: "Sara", color: "pink", avatar: null },
    ],
    subLabels: {},
  };
}

let owner = true;
const calls: string[] = [];
beforeEach(() => {
  nav.search = "";
  owner = true;
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    const u = new URL(url, "http://x");
    const body = u.pathname.endsWith("/drill")
      ? buildDrill(input(u.searchParams, owner), u.searchParams.get("drill")!, null, 40)
      : buildView(input(u.searchParams, owner));
    return new Response(JSON.stringify(body), { status: 200 });
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

const norm = (s: string | null | undefined) => (s ?? "").replace(/[\u2066\u2069]/g, "").replace(/[\s\u00A0\u202F]+/g, " ").trim();

function mount() {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <PerformanceOrders marketId={LY} marketName="Libye" locale="fr" tz="Africa/Tripoli" />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("Performance › Commandes", () => {
  test("shows the result, the money and both lists to the owner", async () => {
    mount();
    expect(await screen.findByRole("heading", { name: "Performance des commandes" })).toBeTruthy();
    const hl = document.querySelector(".hl")!;
    expect(norm(hl.textContent)).toBe("Sur 100 commandes reçues, 65 arrivent chez le client.");
    // Aurore calme: one bar per outcome, counts first; each row opens its orders
    const rows = within(screen.getByRole("list", { name: "Ce que sont devenues les commandes" })).getAllByRole("listitem");
    expect(rows.map((r) => norm(r.querySelector("b")!.textContent))).toEqual(["Livrées", "Retournées", "Rejetées", "Jamais réelles", "En cours"]);
    expect(norm(rows[0].querySelector(".obr-n")!.textContent)).toBe("65");
    expect(document.querySelector(".waffle")).toBeNull();
    expect(screen.getByRole("heading", { name: "L’argent" })).toBeTruthy();
    expect(screen.getByText("Visible par vous seulement")).toBeTruthy();
    expect(norm(document.querySelector(".money .mval")!.textContent)).toBe("6 500 د.ل");
    expect(screen.getByRole("heading", { name: "Par produit" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Par agent" })).toBeTruthy();
    expect(norm(document.querySelector(".dbtn")!.textContent)).toContain("30 derniers jours");
  });

  test("a market manager reads the same page without any money", async () => {
    owner = false;
    mount();
    await screen.findByRole("heading", { name: "Performance des commandes" });
    expect(screen.queryByRole("heading", { name: "L’argent" })).toBeNull();
    expect(document.body.textContent).not.toContain("د.ل");
  });

  test("a click on an agent filters the whole page and keeps it in the URL", async () => {
    const spy = vi.spyOn(window.history, "replaceState");
    mount();
    await screen.findByRole("heading", { name: "Par agent" });
    const row = [...document.querySelectorAll(".agents .pr-row")].find((b) => b.textContent?.includes("Sara"))!;
    fireEvent.click(row);
    expect(String(spy.mock.calls.at(-1)?.[2])).toContain(`ag=${SARA}`);
    await waitFor(() => expect(calls.some((c) => c.includes(`ag=${SARA}`))).toBe(true));
    await waitFor(() => expect(norm(document.querySelector(".hl")!.textContent)).toBe("Sur 40 commandes reçues traitées par Sara, 35 arrivent chez le client."));
  });

  test("an outcome row opens the drawer on its orders", async () => {
    mount();
    const list = await screen.findByRole("list", { name: "Ce que sont devenues les commandes" });
    fireEvent.click(within(list).getByRole("button", { name: /Retournées/ }));
    await waitFor(() => expect(calls.some((c) => c.includes("/drill?") && c.includes("drill=out%3Aret"))).toBe(true));
  });

  test("the filter bar: one button per filter says its value and opens its picker; no dead pills", async () => {
    mount();
    await screen.findByRole("heading", { name: "Performance des commandes" });
    const prod = screen.getByRole("button", { name: /^Produits/ });
    expect(prod).toHaveAccessibleName("Produits · Tous les produits");
    expect(screen.getByRole("button", { name: /^Agents/ })).toHaveAccessibleName("Agents · Toute l’équipe");
    expect(screen.queryByText("Choisir des produits")).toBeNull();
    expect(document.querySelector(".fbar .tagAB")).toBeNull(); // no « A » until there is a B
    fireEvent.click(prod);
    expect(document.querySelector(".picker")).not.toBeNull();
  });

  test("a set filter shows what is chosen and clears with its own ×", async () => {
    nav.search = `ag=${SARA}`;
    mount();
    const btn = await screen.findByRole("button", { name: /^Agents/ });
    await waitFor(() => expect(btn).toHaveAccessibleName("Agents · Sara"));
    expect(btn.closest(".fb")).toHaveClass("set");
    const spy = vi.spyOn(window.history, "replaceState");
    fireEvent.click(screen.getByRole("button", { name: /^Retirer ce filtre\s:\sAgents$/ }));
    expect(String(spy.mock.calls.at(-1)?.[2])).not.toContain("ag=");
  });

  test("Comparer is a menu of three; choosing one shows « A contre B » on its own line", async () => {
    mount();
    await screen.findByRole("heading", { name: "Performance des commandes" });
    expect(document.querySelector(".vsline")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Comparer/ }));
    const menu = screen.getByRole("menu", { name: "Comparer" });
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(3);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Autres agents/ }));
    await waitFor(() => expect(document.querySelector(".vsline")).not.toBeNull());
    const line = document.querySelector(".vsline") as HTMLElement;
    expect(norm(line.textContent)).toContain("contre");
    expect(within(line).getByRole("button", { name: /Choisir l’agent B/ })).toBeTruthy();
    fireEvent.click(within(line).getByRole("button", { name: "Arrêter la comparaison" }));
    await waitFor(() => expect(document.querySelector(".vsline")).toBeNull());
  });

  test("a leak opens the drawer on its exact orders", async () => {
    mount();
    await screen.findByText("Les plus grosses fuites");
    fireEvent.click(screen.getByText("Rejetées sans motif").closest("button")!);
    await waitFor(() => expect(calls.some((c) => c.includes("/drill?") && c.includes("drill=fam%3Aautre"))).toBe(true));
    const drawer = document.querySelector(".drawer.on") as HTMLElement;
    await waitFor(() => expect(norm(within(drawer).getByText(/Les commandes/).textContent)).toBe("Les commandes (20)"));
  });

  test("the date button opens shortcuts, months and a calendar", async () => {
    mount();
    await screen.findByRole("heading", { name: "Performance des commandes" });
    fireEvent.click(document.querySelector(".dbtn")!);
    const dlg = screen.getByRole("dialog", { name: "Choisir les dates" });
    fireEvent.click([...dlg.querySelectorAll(".dp-it")].find((b) => b.textContent?.startsWith("Septembre 2026"))!);
    await waitFor(() => expect(calls.some((c) => c.includes("period=m%3A2026-09"))).toBe(true));
  });
});
