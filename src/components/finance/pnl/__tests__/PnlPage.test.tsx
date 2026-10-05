import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import fr from "@/messages/fr.json";
import { monthWindows, type PnlMonth } from "@/lib/finance/pnl/months";

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/fr/dashboard/pnl",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { PnlPage } from "../PnlPage";

const LY = "00000000-0000-0000-0000-000000000002";

function months(): PnlMonth[] {
  return monthWindows("2026-10-04").map((w, i) => {
    if (w.key === "2026-09") return { key: w.key, live: false, to: w.to, paid: 101640, cogs: 28460, ship: 11180, ads: 34560, pack: 3050, profit: 24390, orders: 452 };
    if (w.key === "2026-08") return { key: w.key, live: false, to: w.to, paid: 88400, cogs: 26000, ship: 10000, ads: 32000, pack: 2720, profit: 17680, orders: 400 };
    const paid = 20000 + i * 1000;
    return { key: w.key, live: w.live, to: w.to, paid, cogs: paid * 0.3, ship: paid * 0.1, ads: paid * 0.4, pack: paid * 0.05, profit: paid * 0.15, orders: 100 };
  });
}

const calls: string[] = [];
beforeEach(() => {
  nav.search = "";
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ today: "2026-10-04", currency: "LYD", months: months() }), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const norm = (s: string | null | undefined) => (s ?? "").replace(/[⁦⁩]/g, "").replace(/[\s  ]+/g, " ").trim();

function mount(marketId: string | null = LY) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <PnlPage marketId={marketId} marketName="Libye" locale="fr" />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("P&L global", () => {
  test("opens on the last closed month: the profit, one sentence, the pipe", async () => {
    mount();
    expect(await screen.findByRole("heading", { level: 1, name: "P&L global" })).toBeTruthy();
    await waitFor(() => expect(norm(document.querySelector(".ans-n")?.textContent)).toBe("24 390د.ل"));
    expect(norm(document.querySelector(".ans-s")!.textContent)).toBe(
      "Sur 100 د.ل payés par vos clients, 24 vous restent — contre 20 en août. 452 commandes livrées.",
    );
    expect(screen.getByText("Mois clos · ne bougera plus")).toBeTruthy();
    const labels = [...document.querySelectorAll(".flow .lab-t")].map((n) => n.textContent);
    expect(labels).toEqual(["Produits", "Livraison", "Pub", "Emballage"]);
    expect([...document.querySelectorAll(".flow .lab-v")].map((n) => norm(n.textContent))).toEqual(["− 28 460", "− 11 180", "− 34 560", "− 3 050"]);
    expect(calls[0]).toContain(`/api/finance/pnl?market_id=${LY}`);
  });

  test("Mois par mois shows 13 columns and a click opens that month", async () => {
    const spy = vi.spyOn(window.history, "replaceState");
    mount();
    await screen.findByRole("heading", { name: "Mois par mois" });
    const cols = document.querySelectorAll(".mcol");
    expect(cols).toHaveLength(13);
    expect(cols[12].classList.contains("live")).toBe(true);
    fireEvent.click(cols[10]);
    await waitFor(() => expect(norm(document.querySelector(".ans-n")!.textContent)).toBe("17 680د.ل"));
    expect(String(spy.mock.calls.at(-1)?.[2])).toContain("m=2026-08");
  });

  test("the month in progress says so and compares with the same days of last month", async () => {
    nav.search = "m=2026-10";
    mount();
    await waitFor(() => expect(screen.getByText(/En cours · jusqu/)).toBeTruthy());
    expect(norm(document.querySelector(".ans-s")!.textContent)).toMatch(/^Depuis le 1er octobre/);
  });

  test("« Tous les marchés » asks for a market instead of guessing one", () => {
    mount(null);
    expect(screen.getByText("Choisissez un marché")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});
