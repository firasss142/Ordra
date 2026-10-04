import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { libyaScorecard, tripoli, TRI, BEN } from "@/test/helpers/scorecardFixture";
import { CarrierView, type CarrierViewProps } from "../CarrierView";

function renderCarrier(over: Partial<CarrierViewProps> = {}) {
  const props: CarrierViewProps = {
    scorecard: libyaScorecard(), carrierId: TRI, locale: "fr", marketCode: "ly", period: 30,
    onPeriodChange: vi.fn(), onOpenDrawer: vi.fn(), onCopyLate: vi.fn(),
    overviewHref: "/fr/carriers?period=30", compareHref: "/fr/carriers/compare?period=30", returnsBenchHref: "/fr/warehouse/returns",
    ...over,
  };
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <CarrierView {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

const text = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ");

describe("CarrierView — one carrier, five questions", () => {
  it("is headed by the account's band, with a way back and a way to compare", () => {
    renderCarrier();
    expect(screen.getByRole("heading", { level: 1, name: "Tripoli" })).toBeInTheDocument();
    const hero = screen.getByRole("heading", { level: 1, name: "Tripoli" }).closest("section") as HTMLElement;
    expect(text(hero)).toContain("Darb Assabil · 369 colis envoyés sur 30 jours");
    expect(hero).toHaveStyle({ "--c": "#1F5FBF" });
    expect(screen.getByRole("link", { name: /Transporteurs/ })).toHaveAttribute("href", "/fr/carriers?period=30");
    expect(screen.getByRole("link", { name: /Comparer avec Benghazi/ })).toHaveAttribute("href", "/fr/carriers/compare?period=30");
  });

  it("answers « does it deliver enough? » with the rate, the target and the weeks", () => {
    renderCarrier();
    const card = screen.getByRole("region", { name: "Livraison" });
    expect(text(card)).toMatch(/51\s?%/);
    expect(text(card)).toContain("Sous l'objectif de 60");
    expect(text(card)).toContain("178 livrés · 172 échoués · 19 en route");
    expect(within(card).getByRole("img")).toBeInTheDocument();
  });

  it("answers « why does it fail? » by who caused it, then the reasons", () => {
    renderCarrier();
    const card = screen.getByRole("region", { name: "Pourquoi ça échoue" });
    const t = text(card);
    expect(t).toContain("298");
    expect(t).toMatch(/Client\s?87\s?%/);
    expect(t).toMatch(/Transporteur\s?9\s?%/);
    expect(t).toContain("Injoignable");
    expect(t).toContain("116");
    expect(t).toContain("Mauvais article envoyé");
  });

  it("says when a carrier sends no reasons at all", () => {
    renderCarrier({
      scorecard: libyaScorecard({ carriers: [tripoli({ id: "nvx", name: "Navex", code: "navex", account_label: null, has_reasons: false, has_attempts: false, reasons: [],
        period: { ...tripoli().period, first_attempt: null } })] }),
      carrierId: "nvx", marketCode: "tn",
    });
    expect(text(screen.getByRole("region", { name: "Pourquoi ça échoue" }))).toContain("Navex n'envoie pas le motif d'un échec.");
    expect(text(screen.getByRole("region", { name: "En retard" }))).toContain("non transmis");
    expect(screen.queryByText(/Comparer avec/)).toBeNull();
  });

  it("answers « what is late right now? » by days since pickup, with the parcels behind it", () => {
    const p = renderCarrier();
    const card = screen.getByRole("region", { name: "En retard" });
    const t = text(card);
    expect(t).toContain("11");
    expect(t).toContain("sur 16 en route");
    expect(t).toContain("dont 3 bloqués");
    for (const b of ["Pas ramassé", "0 à 2 j", "3 à 4 j", "5 à 9 j", "10 j et +"]) expect(t).toContain(b);
    expect(t).toContain("Après 3 jours en route, seul 1 colis sur 3 est livré.");
    expect(t).toContain("1,2 j");
    expect(t).toMatch(/Ramassé en < 6 h\s?76\s?%/);
    expect(t).toMatch(/Au 1er passage\s?40\s?%/);
    fireEvent.click(within(card).getByRole("button", { name: "Voir les 11 colis" }));
    expect(p.onOpenDrawer).toHaveBeenCalledWith("late");
    fireEvent.click(within(card).getByRole("button", { name: "Copier pour Darb" }));
    expect(p.onCopyLate).toHaveBeenCalled();
  });

  it("answers « where are the returns? » — handed back by Darb, never scanned", () => {
    const p = renderCarrier();
    const card = screen.getByRole("region", { name: "Retours" });
    const t = text(card);
    expect(t).toMatch(/444\s?à scanner/);
    expect(t).toContain("dont 392 depuis 7 j +");
    expect(t).toMatch(/Échoués\s?462/);
    expect(t).toMatch(/Rendus par Darb\s?444/);
    expect(t).toMatch(/Scannés chez nous\s?0/);
    expect(t).toMatch(/moins de 7 j\s?52/);
    expect(t).toMatch(/Encore chez Darb\s?18/);
    expect(t).toMatch(/6 j/);
    expect(within(card).getByRole("link", { name: /Ouvrir le banc Retours/ })).toHaveAttribute("href", "/fr/warehouse/returns");
    fireEvent.click(within(card).getByRole("button", { name: /Voir la liste/ }));
    expect(p.onOpenDrawer).toHaveBeenCalledWith("returns");
  });

  it("answers « where does it fail? » with the cities in French", () => {
    const p = renderCarrier();
    const card = screen.getByRole("region", { name: "Villes" });
    const t = text(card);
    expect(t).toContain("Tripoli");
    expect(t).toMatch(/42\s?%/);
    expect(t).toContain("219 colis");
    expect(t).toContain("Benghazi");
    fireEvent.click(within(card).getByRole("button", { name: "Voir les 8 villes" }));
    expect(p.onOpenDrawer).toHaveBeenCalledWith("cities");
  });

  it("opens Benghazi just as well", () => {
    renderCarrier({ carrierId: BEN });
    expect(screen.getByRole("heading", { level: 1, name: "Benghazi" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Comparer avec Tripoli/ })).toBeInTheDocument();
  });
});
