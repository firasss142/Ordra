import { render, screen, within, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";
import { libyaScorecard, tripoli, benghazi, BEN, DEX } from "@/test/helpers/scorecardFixture";
import { OverviewView, type OverviewViewProps } from "../OverviewView";

const NOW = new Date("2026-10-03T12:00:00Z");

function renderOverview(over: Partial<OverviewViewProps> = {}, locale: "fr" | "ar" = "fr") {
  const props: OverviewViewProps = {
    scorecard: libyaScorecard(), locale, marketCode: "ly", period: 30, now: NOW,
    onPeriodChange: vi.fn(), onOpenDormant: vi.fn(),
    carrierHref: (id) => `/fr/carriers/${id}?period=30`, compareHref: "/fr/carriers/compare?period=30",
    ...over,
  };
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "fr" ? fr : ar}>
      <OverviewView {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

const text = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ");

describe("OverviewView — the market, then one card per carrier", () => {
  it("heads the page with the market, the window and the carrier sync", () => {
    renderOverview();
    expect(screen.getByRole("heading", { level: 1, name: "Transporteurs" })).toBeInTheDocument();
    expect(screen.getByText(/Libye · 3 sept\./)).toBeInTheDocument();
    expect(screen.getByText("Synchro il y a 8 min")).toBeInTheDocument();
  });

  it("sums the market in four numbers", () => {
    renderOverview();
    const strip = text(screen.getByRole("region", { name: "Vue d'ensemble" }));
    expect(strip).toContain("Colis envoyés");
    expect(strip).toMatch(/598/);
    expect(strip).toContain("dont 34 encore en route");
    expect(strip).toMatch(/52\s?%/);
    expect(strip).toContain("Sous l'objectif de 60");
    expect(strip).toMatch(/En retard.*23/);
    expect(strip).toContain("dont 4 bloqués");
    expect(strip).toMatch(/542/);
    expect(strip).toContain("dont 478 depuis 7 j +");
  });

  it("gives each Darb account its city as a name, its colour as a band, and its three numbers", () => {
    renderOverview();
    const card = screen.getByRole("article", { name: "Tripoli" });
    expect(card).toHaveStyle({ "--c": "#1F5FBF" });
    const t = text(card);
    expect(t).toContain("Tripoli");
    expect(t).toContain("Darb Assabil");
    expect(t).toMatch(/51\s?%/);
    expect(t).toContain("Sous l'objectif");
    expect(t).toContain("stable");
    expect(t).toMatch(/En retard\s?11/);
    expect(t).toContain("dont 3 bloqués");
    expect(t).toContain("sur 16 en route");
    expect(t).toMatch(/444/);
    expect(t).toContain("dont 392 depuis 7 j +");
    expect(t).toContain("rendus par Darb");
    expect(within(card).getByRole("img", { name: /Tripoli/ })).toBeInTheDocument();
  });

  it("opens the carrier from its card", () => {
    renderOverview();
    const card = screen.getByRole("article", { name: "Benghazi" });
    expect(card.closest("a")).toHaveAttribute("href", `/fr/carriers/${BEN}?period=30`);
    expect(text(card)).toContain("Compte ouvert le 7 sept.");
  });

  it("offers Comparer and the period, and lists a dormant carrier still holding parcels", () => {
    const p = renderOverview();
    expect(screen.getByRole("link", { name: /Comparer/ })).toHaveAttribute("href", "/fr/carriers/compare?period=30");
    fireEvent.click(screen.getByRole("button", { name: "7 j" }));
    expect(p.onPeriodChange).toHaveBeenCalledWith(7);
    const dormant = screen.getByRole("region", { name: "Transporteurs inactifs" });
    expect(text(dormant)).toContain("Dexpress · inactif depuis mai · 323 colis restés sans issue");
    fireEvent.click(within(dormant).getByRole("button", { name: "Voir" }));
    expect(p.onOpenDormant).toHaveBeenCalledWith(DEX);
  });

  it("calls a provisional period provisional, never on target", () => {
    renderOverview({ scorecard: libyaScorecard({ carriers: [tripoli({ period: { ...tripoli().period, sent: 70, delivered: 36, failed: 22, in_flight: 12 } }), benghazi()] }) });
    expect(text(screen.getByRole("article", { name: "Tripoli" }))).toContain("Provisoire");
  });

  it("shows the empty state when nothing left in the window", () => {
    const empty = (c: ReturnType<typeof tripoli>) => ({ ...c, period: { ...c.period, sent: 0, delivered: 0, failed: 0, in_flight: 0 } });
    renderOverview({ scorecard: libyaScorecard({ carriers: [empty(tripoli()), empty(benghazi())], dormant: [] }) });
    expect(screen.getByText("Aucun colis envoyé sur la période")).toBeInTheDocument();
    expect(screen.getAllByText("Aucun colis sur la période")).toHaveLength(2);
  });

  it("speaks Arabic, city names included", () => {
    renderOverview({}, "ar");
    expect(screen.getByRole("heading", { level: 1, name: "شركات التوصيل" })).toBeInTheDocument();
    const t = text(screen.getByRole("article", { name: "طرابلس" }));
    expect(t).toContain("طرابلس");
    expect(t).toContain("درب السبيل");
    expect(t).toContain("منها 3 عالقة");
  });
});
