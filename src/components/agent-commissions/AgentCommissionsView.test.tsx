import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";
import { AgentCommissionsView } from "./AgentCommissionsView";
import type { AgentStatement, StatementCredit } from "@/lib/commissions/types";

/**
 * « Mes commissions » in the agent shell « Aurore » (prototypes/agent-shell-v2.html § 5).
 * Every figure is the statement RPC's (plus `way.likely_each`, attached server-side by the
 * API route); the page only formats. These tests read the real fr.json, so a key that
 * exists only in the component fails here.
 */

let phone = false;
vi.mock("@/hooks/useMediaQuery", () => ({
  useMediaQuery: () => phone,
  PHONE_QUERY: "(max-width: 767px)",
}));

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
    likely_each: 7,
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

function mount(me: AgentStatement = ME, locale: "fr" | "ar" = "fr", onMore = () => {}) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "fr" ? fr : ar}>
      <AgentCommissionsView me={me} marketCode="LY" locale={locale} tz="Africa/Tripoli" onMore={onMore} />
    </NextIntlClientProvider>,
  );
}

const text = (el: Element) => (el.textContent ?? "").replace(/[⁦-⁩]/g, "").replace(/\s+/g, " ");
const rows = () => Array.from(document.querySelectorAll(".crow")).map(text);

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
});
afterAll(() => vi.useRealTimers());
beforeEach(() => { phone = false; });

describe("Mes commissions — the header and the money", () => {
  it("states the rule in the header: the rate per delivered order, since activation, and what it was before", () => {
    mount();
    const h = screen.getByRole("heading", { level: 1, name: "Mes commissions" });
    const statp = h.closest("header")!.querySelector(".statp")!;
    expect(text(statp)).toMatch(/10\sد\.ل\. par commande livrée · depuis le 12 sept\./);
    expect(text(statp)).toMatch(/avant 9\sد\.ل\./);
  });

  it("says what is owed, for how many unpaid deliveries, and proves it: Gagné − Reçu = Reste à recevoir", () => {
    mount();
    const hero = document.querySelector(".hero2")!;
    expect(text(hero)).toContain("Ce qu'on te doit maintenant");
    expect(text(hero.querySelector(".big2")!)).toMatch(/^13\s?د\.ل\.$/);
    expect(text(hero)).toContain("pour 2 commandes livrées pas encore payées · livrées du 27 sept. au 29 sept.");
    const eq = hero.querySelector(".eq")!;
    expect(text(eq)).toMatch(/Gagné\s?36\s?−\s?Reçu\s?23\s?=\s?Reste à recevoir\s?13\sد\.ل\./);
    const bar = hero.querySelector(".pbar3")!;
    expect(bar.getAttribute("role")).toBe("img");
    expect(bar.getAttribute("aria-label")!.replace(/[⁦-⁩]/g, "")).toMatch(/^Reçu 23\sد\.ل\., reste 13\sد\.ل\.$/);
    expect(text(hero.querySelector(".last")!)).toMatch(/Dernier paiement 26 sept\. · 10\sد\.ل\. en espèces/);
  });

  it("an overpaid agent reads « Reçu en trop », and the sentence says it comes off the next deliveries", () => {
    mount({ ...ME, paid: 41, owed: -5, unpaid: { count: 0, amount: 0, rows: [] } });
    const hero = document.querySelector(".hero2")!;
    expect(text(hero)).toContain("Reçu en trop");
    expect(text(hero)).toMatch(/Tu as reçu 5\sد\.ل\. de plus que ce que tu as gagné/);
  });

  it("a switched-off commission says so, and the road stops promising money", () => {
    mount({ ...ME, enabled: false, rate: { ...ME.rate, previous_amount: null, off_since: "2026-09-29" }, way: { ...ME.way, est: 0, est_likely: null, likely_each: null } });
    expect(text(screen.getByRole("status"))).toContain("Ta commission est coupée depuis le");
    expect(text(document.querySelectorAll(".card2")[0])).toContain("Ne compteront pas — commission coupée");
  });

  it("an account that never had a commission explains it instead of showing zeros", () => {
    mount({ ...ME, enabled: false, activated_on: null, owed: 0, earned: 0, paid: 0, last_payout: null,
      unpaid: { count: 0, amount: 0, rows: [] }, paid_orders: { count: 0, amount: 0, payouts: [] },
      way: { ...ME.way, count: 0, rows: [] }, lost: { ...ME.lost, count: 0, rows: [] } });
    expect(screen.getByText("Les commissions ne sont pas activées pour ton compte.")).toBeTruthy();
    expect(document.querySelector(".hero2")).toBeNull();
  });
});

describe("Mes commissions — the road and the rate", () => {
  it("counts what is on the road, the ≈ if all arrive and the usual share, chips by stage, and links to Livraison", () => {
    mount();
    const way = document.querySelectorAll(".card2")[0] as HTMLElement;
    expect(text(way.querySelector(".kv")!)).toBe("3 commandes");
    expect(text(way)).toMatch(/≈ 20\sد\.ل\. si toutes sont livrées — d'habitude 7 sur 10 le sont, soit ≈ 14\sد\.ل\./);
    const chips = Array.from(way.querySelectorAll(".chipm")).map(text);
    expect(chips).toEqual(["Chez le transporteur · 1", "En retard · 1", "En retour · 1"]);
    expect(within(way).getByRole("link", { name: /Suivre les retards dans « Livraison »/ }).getAttribute("href")).toBe("/fr/delivery");
  });

  it("shows the delivery rate and the funnel of where the confirmed orders went", () => {
    mount();
    const card = document.querySelectorAll(".card2")[1] as HTMLElement;
    expect(text(card.querySelector(".kv")!)).toMatch(/^71\s?%$/);
    expect(text(card)).toContain("Sur 10 commandes confirmées arrivées au bout, 7 ont été livrées et payées.");
    expect(within(card).getByRole("img", { name: /Livrées 5, En route 3, Non livrées 2, À téléverser 1, Revenues dans la file 1/ })).toBeTruthy();
    expect(Array.from(card.querySelectorAll(".leg span")).map(text)).toEqual([
      "Livrées 5", "En route 3", "Non livrées 2", "À téléverser 1", "Revenues dans la file 1",
    ]);
  });
});

describe("Mes commissions — the four lists", () => {
  it("each tab carries its count; Pas payées is open first, grouped by day with the day's + amount", () => {
    mount();
    expect(screen.getAllByRole("tab").map(text)).toEqual(["Pas payées2", "En route3", "Payées2", "Sans commission3"]);
    const days = Array.from(document.querySelectorAll(".dayh")).map(text);
    expect(days[0]).toMatch(/^Hier\s?\+9\sد\.ل\.$/);
    expect(days[1]).toMatch(/^27 sept\.\s?\+4\sد\.ل\.$/);
    const r = rows();
    expect(r[0]).toContain("Fatma Zaid");
    expect(r[0]).toMatch(/Dibio · Tripoli/);
    expect(r[0]).toMatch(/\+9\s?د\.ل\./);
    expect(r[1]).toMatch(/payée en partie — reste 4\sد\.ل\. sur 9\sد\.ل\./);
  });

  it("the road lists each parcel with its stage, how long it has been out, and what it will likely earn", () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: /En route/ }));
    const r = rows();
    expect(r[0]).toContain("Hana Sharif");
    expect(r[0]).toContain("En retard");
    expect(r[0]).toMatch(/≈ 7\s?د\.ل\./);
    expect(r[1]).toContain("11 jours chez le transporteur");
    expect(document.querySelectorAll(".crow")[1].querySelector(".tm.warn")).toBeTruthy();
    expect(r[2]).not.toContain("≈");
  });

  it("paid orders sit under the payout that settled them; the payout row opens", () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: /Payées/ }));
    const btn = screen.getByRole("button", { name: /Paiement du 26 sept\./ });
    expect(text(btn)).toContain("en espèces · a réglé 1 livrée du 24 sept. au 24 sept. · une commande réglée en deux fois");
    expect(text(btn)).toMatch(/10\s?د\.ل\./);
    expect(screen.queryByText("Ali Misrati")).toBeNull();
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Ali Misrati")).toBeTruthy();
  });

  it("orders without commission say why, strike what they would have earned, and filter by reason", () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: /Sans commission/ }));
    expect(rows()).toHaveLength(3);
    expect(rows()[0]).toContain("Annulée par le transporteur");
    expect(document.querySelector(".crow .plus.strike")).toBeTruthy();
    const fil = document.querySelector(".cfil") as HTMLElement;
    expect(within(fil).getAllByRole("button").map(text)).toEqual([
      "Toutes", "Annulée par le transporteur", "Rejetée", "Téléversée avant l'activation",
    ]);
    fireEvent.click(within(fil).getByRole("button", { name: "Rejetée" }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain("Amna Tarhouni");
  });

  it("closes with the rule, at the rate from the database", () => {
    mount();
    expect(text(document.querySelector(".rule2")!)).toMatch(/La règle : 10\sد\.ل\. pour chaque commande que tu as confirmée/);
  });
});

describe("Mes commissions — phone and Arabic", () => {
  it("on a phone the page has no header (the shell titles it) but keeps the hero and the lists", () => {
    phone = true;
    mount();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(document.querySelector(".hero2")).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
  });

  it("reads in Arabic with the prototype's words", () => {
    mount(ME, "ar");
    expect(screen.getByRole("heading", { level: 1, name: "عمولاتي" })).toBeTruthy();
    expect(text(document.querySelector(".hero2")!)).toContain("ما نَدين لك به الآن");
    expect(screen.getAllByRole("tab").map(text)[0]).toBe("غير مدفوعة2");
  });
});
