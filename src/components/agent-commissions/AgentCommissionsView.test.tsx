import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { AgentCommissionsView } from "./AgentCommissionsView";
import type { AgentStatement, StatementCredit } from "@/lib/commissions/types";

/**
 * « Mes commissions » v2 (prototypes/agent-commissions-v2.html). The page's one rule:
 * every number at the top is a tab below whose rows add up to it. These tests read
 * the real fr.json, so a key that exists only in the component fails here.
 */

const credit = (over: Partial<StatementCredit>): StatementCredit => ({
  order_id: "o", external_id: "x", customer_name: "?", product_name: "Dibio", image_url: null, city: "Tripoli",
  kind: "accrual", note: null, at: "2026-09-29T12:00:00Z", amount: 9, full_amount: 9, ...over,
});

const ME: AgentStatement = {
  enabled: true,
  currency: "LYD",
  rate: { amount: 10, effective_from: "2026-09-30", previous_amount: 9, off_since: null },
  activated_on: "2026-09-12",
  since: "2026-09-12",
  earned: 36,
  paid: 23,
  owed: 13,
  last_payout: { at: "2026-09-26T12:00:00Z", amount: 10, method: "cash" },
  unpaid: {
    count: 2,
    amount: 13,
    rows: [
      credit({ order_id: "u1", customer_name: "Fatma Zaid", at: "2026-09-29T12:00:00Z" }),
      credit({ order_id: "u2", customer_name: "Salem Warfalli", at: "2026-09-27T12:00:00Z", amount: 4, partial: true }),
    ],
  },
  paid_orders: {
    count: 2,
    amount: 18,
    payouts: [
      { at: "2026-09-26T12:00:00Z", amount: 10, method: "cash", reference: null, count: 1, from: "2026-09-24T12:00:00Z", to: "2026-09-24T12:00:00Z",
        has_split: true, rows_omitted: false, rows: [credit({ order_id: "p2", customer_name: "Ali Misrati", at: "2026-09-24T12:00:00Z", split: true })] },
      { at: "2026-09-21T12:00:00Z", amount: 13, method: "cash", reference: null, count: 1, from: "2026-09-20T12:00:00Z", to: "2026-09-20T12:00:00Z",
        has_split: false, rows_omitted: false, rows: [credit({ order_id: "p1", customer_name: "Mariam Zawi", at: "2026-09-20T12:00:00Z", split: false })] },
    ],
  },
  way: {
    count: 3,
    est: 20,
    est_likely: 14,
    stages: { awaiting_scan: 0, with_carrier: 1, out: 0, delayed: 1, returning: 1 },
    rows: [
      { order_id: "w1", external_id: "w1", customer_name: "Hana Sharif", product_name: "Dibio", image_url: null, city: "Benghazi", stage: "delayed", uploaded_at: "2026-09-26T10:00:00Z", stage_at: "2026-09-28T10:00:00Z" },
      { order_id: "w2", external_id: "w2", customer_name: "Omar Taher", product_name: "Dibio", image_url: null, city: "Jalu", stage: "with_carrier", uploaded_at: "2026-09-19T10:00:00Z", stage_at: "2026-09-20T10:00:00Z" },
      { order_id: "w3", external_id: "w3", customer_name: "Zineb Obeidi", product_name: "Dibio", image_url: null, city: "Sirte", stage: "returning", uploaded_at: "2026-09-22T10:00:00Z", stage_at: "2026-09-27T10:00:00Z" },
    ],
  },
  lost: {
    count: 3, carrier_cancelled: 1, cancelled: 0, rejected: 1, returned: 0, before_activation: 1, commission_off: 0, corrected: 0,
    rows: [
      { order_id: "l1", external_id: "l1", customer_name: "Khaled Senussi", product_name: "Dibio", image_url: null, city: "Sabha", reason: "carrier_cancelled", at: "2026-09-27T10:00:00Z", uploaded_at: "2026-09-23T10:00:00Z", was_amount: null },
      { order_id: "l2", external_id: "l2", customer_name: "Amna Tarhouni", product_name: "Dibio", image_url: null, city: "Tripoli", reason: "rejected", at: "2026-09-17T10:00:00Z", uploaded_at: null, was_amount: null },
      { order_id: "l3", external_id: "l3", customer_name: "Youssef Kikli", product_name: "Dibio", image_url: null, city: "Kufra", reason: "before_activation", at: "2026-09-14T10:00:00Z", uploaded_at: "2026-09-08T10:00:00Z", was_amount: 9 },
    ],
  },
  funnel: { confirmed: 12, delivered: 5, way: 3, lost: 2, awaiting_upload: 1, back_in_queue: 1 },
  delivery_rate: 0.714,
};

function mount(me: AgentStatement = ME) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <AgentCommissionsView me={me} marketCode="LY" locale="fr" tz="Africa/Tripoli" onMore={() => {}} />
    </NextIntlClientProvider>,
  );
}

const text = (el: HTMLElement) => (el.textContent ?? "").replace(/[⁦-⁩]/g, "").replace(/\s+/g, " ");

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
});
afterAll(() => vi.useRealTimers());

describe("AgentCommissionsView — the money", () => {
  it("says what is owed, for how many unpaid deliveries, and proves it: earned − received = left", () => {
    mount();
    const hero = screen.getByTestId("commission-hero");
    expect(text(hero)).toContain("Ce qu'on te doit maintenant");
    expect(text(hero)).toMatch(/13\sد\.ل\./);
    expect(text(hero)).toContain("pour 2 commandes livrées pas encore payées");
    const eq = within(hero).getByTestId("commission-equation");
    expect(text(eq)).toMatch(/Gagné\s?36\sد\.ل\./);
    expect(text(eq)).toMatch(/Reçu\s?23\sد\.ل\./);
    expect(text(eq)).toMatch(/Reste à recevoir\s?13\sد\.ل\./);
    expect(text(hero)).toMatch(/Dernier paiement .*10\sد\.ل\. en espèces/);
  });

  it("says the rate changed today and what it was", () => {
    mount();
    const rate = screen.getByTestId("commission-rate");
    expect(text(rate)).toMatch(/10\sد\.ل\. par commande livrée/);
    expect(text(rate)).toContain("depuis aujourd'hui");
    expect(text(rate)).toMatch(/avant 9\sد\.ل\./);
  });

  it("an overpaid agent reads « reçu en trop », not a green « reste à recevoir »", () => {
    mount({ ...ME, paid: 41, owed: -5, unpaid: { count: 0, amount: 0, rows: [] } });
    const hero = screen.getByTestId("commission-hero");
    expect(text(hero)).toContain("Reçu en trop");
    expect(text(hero)).toMatch(/Tu as reçu 5\sد\.ل\. de plus que ce que tu as gagné/);
  });

  it("a switched-off commission says so, and the road stops promising money", () => {
    mount({ ...ME, enabled: false, rate: { ...ME.rate, previous_amount: null, off_since: "2026-09-29" }, way: { ...ME.way, est: 0, est_likely: null } });
    expect(screen.getByRole("status").textContent).toContain("Ta commission est coupée depuis le");
    expect(text(screen.getByTestId("commission-way"))).toContain("Ne compteront pas — commission coupée");
  });

  it("an account that never had a commission explains it instead of showing zeros", () => {
    mount({ ...ME, enabled: false, activated_on: null, owed: 0, earned: 0, paid: 0, last_payout: null,
      unpaid: { count: 0, amount: 0, rows: [] }, paid_orders: { count: 0, amount: 0, payouts: [] },
      way: { ...ME.way, count: 0, rows: [] }, lost: { ...ME.lost, count: 0, rows: [] } });
    expect(screen.getByText("Les commissions ne sont pas activées pour ton compte.")).toBeTruthy();
    expect(screen.queryByTestId("commission-hero")).toBeNull();
  });
});

describe("AgentCommissionsView — the road and the rate", () => {
  it("counts what is on the road by stage, with the likely amount, and sends late parcels to Livraison", () => {
    mount();
    const way = screen.getByTestId("commission-way");
    expect(text(way)).toContain("3 commandes");
    expect(text(way)).toMatch(/≈ 20\sد\.ل\. si toutes sont livrées/);
    expect(text(way)).toMatch(/d'habitude 7 sur 10 sont livrées — soit ≈ 14\sد\.ل\./);
    expect(text(way)).toMatch(/En retard\s?1/);
    expect(within(way).getByRole("link", { name: /Suivre les retards/ }).getAttribute("href")).toBe("/fr/delivery");
  });

  it("shows the delivery rate and where the confirmed orders went", () => {
    mount();
    const card = screen.getByTestId("commission-delivery-rate");
    expect(text(card)).toMatch(/71\s?%/);
    expect(text(card)).toContain("7 ont été livrées et payées");
    expect(text(card)).toMatch(/12 confirmées depuis le/);
    expect(text(card)).toMatch(/Livrées\s?5/);
    expect(text(card)).toMatch(/Non livrées\s?2/);
  });
});

describe("AgentCommissionsView — the four lists", () => {
  it("each tab carries the count of the figure above it; unpaid is open first and sums to the balance", () => {
    mount();
    const tabs = screen.getAllByRole("tab").map((t) => text(t));
    expect(tabs).toEqual(["Pas payées2", "En route3", "Payées2", "Sans commission3"]);
    const list = screen.getByTestId("commission-list");
    expect(text(list)).toMatch(/2 commandes livrées · 13\sد\.ل\./);
    expect(text(list)).toContain("Fatma Zaid");
    expect(text(list)).toMatch(/payée en partie — reste 4\sد\.ل\. sur 9\sد\.ل\./);
  });

  it("paid orders sit under the payout that settled them, and a split is said", () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: /Payées/ }));
    const list = screen.getByTestId("commission-list");
    expect(text(list)).toMatch(/Paiement du 26 sept/);
    expect(text(list)).toContain("une commande réglée en deux fois");
    expect(screen.queryByText("Ali Misrati")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Paiement du 26 sept/ }));
    expect(screen.getByText("Ali Misrati")).toBeTruthy();
    expect(text(list)).toContain("réglée en deux fois");
  });

  it("the road lists late parcels first and flags one stuck at the carrier", () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: /En route/ }));
    const names = screen.getAllByTestId("commission-row").map((r) => text(r));
    expect(names[0]).toContain("Hana Sharif");
    expect(names[1]).toContain("11 jours chez le transporteur");
  });

  it("orders without commission say why, and filter by reason", () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: /Sans commission/ }));
    const list = screen.getByTestId("commission-list");
    expect(text(list)).toContain("Khaled Senussi");
    expect(text(list)).toContain("comptée puis annulée");
    fireEvent.click(within(list).getByRole("button", { name: /Annulée par le transporteur/ }));
    expect(screen.getAllByTestId("commission-row")).toHaveLength(1);
    expect(screen.queryByText("Youssef Kikli")).toBeNull();
  });
});
