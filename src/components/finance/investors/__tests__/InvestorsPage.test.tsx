import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import fr from "@/messages/fr.json";
import { buildInvestorsView, type InvestorsInput } from "@/lib/finance/investors/model";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/fr/finance/investors",
  useSearchParams: () => new URLSearchParams(""),
}));

import { InvestorsPage } from "../InvestorsPage";

const LY = "00000000-0000-0000-0000-000000000002";
const day = (d: string, share: number, net = share / 0.4) => ({ d, share, net });
const input: InvestorsInput = {
  today: "2026-10-04",
  investors: [
    { id: "a", name: "Ahmed B.", method: "bank_transfer" },
    { id: "h", name: "Hana M.", method: null },
  ],
  deals: [
    { id: "d1", investorId: "a", productName: "Tadabbur", productImage: null, status: "active", start: "2026-05-01", end: "2027-03-31", sharePct: 40, capital: 30000, cadence: "monthly" },
    { id: "d2", investorId: "h", productName: "Coran couleurs", productImage: null, status: "active", start: "2026-08-01", end: "2027-07-31", sharePct: 35, capital: 20000, cadence: "quarterly" },
  ],
  series: [
    { dealId: "d1", days: [day("2026-05-10", 1240), day("2026-06-10", 1560), day("2026-07-10", 1840), day("2026-08-10", 2120), day("2026-09-10", 2880)] },
    { dealId: "d2", days: [day("2026-08-15", 910, 2600), day("2026-09-15", 1085, 3100)] },
  ],
  statements: [{ dealId: "d1", periodEnd: "2026-08-31", share: 6760, settledAt: "2026-09-03T10:00:00Z" }],
  withdrawals: [{ investorId: "a", amount: 6760, paidAt: "2026-09-30T10:00:00Z" }],
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...buildInvestorsView(input), today: "2026-10-04", currency: "LYD" }), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

const norm = (s: string | null | undefined) => (s ?? "").replace(/[⁦⁩]/g, "").replace(/[\s  ]+/g, " ").trim();

function mount(marketId: string | null = LY, canManage = true) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <InvestorsPage marketId={marketId} marketName="Libye" locale="fr" canManage={canManage} />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("Investisseurs", () => {
  test("the overview reads as an equation: earned = paid + due", async () => {
    mount();
    const ov = await screen.findByRole("region", { name: "Leur argent, en tout" });
    const tiles = [...ov.querySelectorAll(".t-n")].map((n) => norm(n.textContent));
    expect(tiles).toEqual(["50 000د.ل", "11 635د.ل", "6 760د.ل", "4 875د.ل"]);
  });

  test("one card per person, with their figures", async () => {
    mount();
    const card = await screen.findByRole("button", { name: /^Ahmed B\. —/ });
    expect(within(card).getByText("Tadabbur")).toBeTruthy();
    expect(norm(card.querySelector(".fig")!.textContent)).toContain("Gagné9 640د.ل");
    expect(screen.getByRole("button", { name: /^Hana M\. —/ })).toBeTruthy();
  });

  test("September is closed and not yet in a statement: the page asks to close it", async () => {
    mount();
    const todo = await screen.findByRole("region", { name: "À faire" });
    expect(norm(todo.textContent)).toContain("Septembre est clos — 2 relevés à préparer");
    expect(within(todo).getByRole("link", { name: "Clôturer le mois" }).getAttribute("href")).toBe("/fr/finance/investors?view=console&tab=close");
  });

  test("a card opens the person's drawer: their money, their contract, statements, payments", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /^Ahmed B\. —/ }));
    const dlg = await screen.findByRole("dialog", { name: "Ahmed B." });
    expect(within(dlg).getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["Son argent", "Son contrat", "Relevés", "Versements"]);
    expect(within(dlg).getAllByText("Dans un relevé")).toHaveLength(4);
    expect(within(dlg).getByText("À clôturer")).toBeTruthy();
  });

  test("a market manager reads without the write buttons", async () => {
    mount(LY, false);
    await screen.findByRole("button", { name: /^Ahmed B\. —/ });
    expect(screen.queryByRole("link", { name: "Contrat" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Clôturer le mois" })).toBeNull();
  });

  test("« Tous les marchés » asks for a market", () => {
    mount(null);
    expect(screen.getByText("Choisissez un marché")).toBeTruthy();
  });
});
