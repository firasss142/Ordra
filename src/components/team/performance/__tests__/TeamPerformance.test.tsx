import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";
import { buildView } from "@/lib/team/performance/build";
import { normalizeFacts } from "@/lib/team/performance/facts";
import { parsePeriodKind, resolvePeriod } from "@/lib/team/performance/period";

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/fr/team/performance",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { TeamPerformance } from "../TeamPerformance";

const LY = "00000000-0000-0000-0000-000000000002";
const TASNIM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALIMA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RIHEB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TODAY = "2026-10-03";

const ord = (a: string, st: string, x: Record<string, unknown> = {}) => ({ a, cur: true, st, upl: st === "delivered", rsn: null, sub: null, p: "p1", no_try: false, late: false, ...x });
const many = (n: number, f: () => object) => Array.from({ length: n }, f);
const RAW = {
  agents: [
    { id: TASNIM, name: "tasnim", color: "indigo", avatar_url: null },
    { id: SALIMA, name: "salima", color: "pink", avatar_url: null },
    { id: RIHEB, name: "riheb", color: "orange", avatar_url: null },
  ],
  orders: [
    ...many(50, () => ord(TASNIM, "delivered")),
    ...many(60, () => ord(TASNIM, "rejected", { sub: "autre" })),
    ...many(30, () => ord(SALIMA, "delivered")),
    ...many(40, () => ord(SALIMA, "rejected", { sub: "prix_eleve" })),
    ...many(4, () => ord(RIHEB, "pending")),
  ],
  decisions: [{ a: TASNIM, cur: true, up: 50, rej: 60 }, { a: SALIMA, cur: true, up: 30, rej: 40 }],
  actions: [
    { a: TASNIM, day: "2026-09-27", mins: [840, 900, 960, 1080] },
    { a: SALIMA, day: "2026-09-27", mins: [870, 930, 1000] },
  ],
  products: [{ id: "p1", name: "القرآن تدبر وعمل", image_url: null }],
  reasons: [{ key: "prix_eleve", group: "refus_client", fr: "Prix trop élevé", ar: "السعر مرتفع" }],
};

const calls: string[] = [];
beforeEach(() => {
  nav.search = "";
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    const u = new URL(url, "http://x");
    const w = resolvePeriod(parsePeriodKind(u.searchParams.get("period")), TODAY, u.searchParams.get("from"), u.searchParams.get("to"));
    return new Response(JSON.stringify(buildView(normalizeFacts(RAW), w)), { status: 200 });
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

function renderPage(locale: "fr" | "ar" = "fr") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "fr" ? fr : ar}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <TeamPerformance marketId={LY} marketName="Libye" locale={locale} tz="Africa/Tripoli" />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

describe("Performance › Équipe", () => {
  test("draws the five blocks from the API's view", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Performance équipe" })).toBeInTheDocument();
    expect(calls[0]).toContain(`/api/team/performance?market_id=${LY}&period=30d`);
    expect(screen.getByText("Sur 100 commandes attribuées")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Classement" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Débit × taux" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Par produit" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Présence" })).toBeInTheDocument();
  });

  test("one card per ranked agent, her biggest leak and the line to tell her; the small ones as chips", async () => {
    renderPage();
    const cards = await screen.findAllByRole("button", { expanded: false });
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("tasnim");
    expect(cards[0]).toHaveTextContent("Motif « Autre »");
    expect(cards[0]).toHaveTextContent("Choisir le vrai motif, pas « Autre »");
    expect(screen.getByText("Hors classement · moins de 30 commandes")).toBeInTheDocument();
    expect(screen.getByText("4 attribuées")).toBeInTheDocument();
  });

  test("a card opens her detail and focuses the page on her; Escape lets go", async () => {
    renderPage();
    const [tasnim] = await screen.findAllByRole("button", { expanded: false });
    fireEvent.click(tasnim);
    expect(await screen.findByRole("heading", { name: "Pourquoi tasnim perd des commandes" })).toBeInTheDocument();
    expect(window.location.search).toContain(`agent=${TASNIM}`);
    expect(screen.getByRole("link", { name: /Ses journées dans la Salle de contrôle/ })).toHaveAttribute("href", `/fr/team?agent=${TASNIM}`);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: /Pourquoi tasnim/ })).not.toBeInTheDocument());
  });

  test("the period control reads another window", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "7 jours" }));
    await waitFor(() => expect(calls.some((c) => c.includes("period=7d"))).toBe(true));
    expect(await screen.findByText(/Les colis de moins de 14 jours/)).toBeInTheDocument();
  });

  test("« Chiffres » swaps the map for the table", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Chiffres" }));
    expect(screen.getByRole("columnheader", { name: "Débit" })).toBeInTheDocument();
    expect(window.location.search).toContain("view=table");
  });

  test("présence opens on the latest worked day and links it to the Salle de contrôle", async () => {
    renderPage();
    expect(await screen.findByRole("link", { name: /Ouvrir ce jour dans la Salle de contrôle/ })).toHaveAttribute("href", "/fr/team?day=2026-09-27");
  });

  test("Arabic renders the same page", async () => {
    renderPage("ar");
    expect(await screen.findByRole("heading", { name: "أداء الفريق" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "الترتيب" })).toBeInTheDocument();
  });
});
