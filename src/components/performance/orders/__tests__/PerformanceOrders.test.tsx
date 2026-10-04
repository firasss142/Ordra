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
    await waitFor(() => expect(norm(document.querySelector(".hl")!.textContent)).toContain("traitées par Sara"));
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
