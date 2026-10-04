import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { libyaScorecard, tripoli } from "@/test/helpers/scorecardFixture";
import { CompareView, type CompareViewProps } from "../CompareView";

function renderCompare(over: Partial<CompareViewProps> = {}) {
  const props: CompareViewProps = {
    scorecard: libyaScorecard(), locale: "fr", marketCode: "ly", period: 30, now: new Date("2026-10-03T12:00:00Z"),
    onPeriodChange: vi.fn(), overviewHref: "/fr/carriers?period=30", ...over,
  };
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <CompareView {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

const text = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ");

describe("CompareView — overall first, then city by city", () => {
  it("sets the two accounts face to face", () => {
    renderCompare();
    expect(screen.getByRole("heading", { level: 1, name: "Comparer" })).toBeInTheDocument();
    const global = screen.getByRole("region", { name: "Vue globale" });
    expect(text(global)).toMatch(/Tripoli.*369 colis/);
    expect(text(global)).toMatch(/Benghazi.*229 colis/);
  });

  it("marks the better share on each line, and calls a gap under 3 points a tie", () => {
    renderCompare();
    const row = (name: string) => screen.getByRole("group", { name });
    expect(text(row("Taux de livraison"))).toContain("à égalité");
    expect(within(row("Ramassés en moins de 6 h")).getByTitle("meilleur").textContent).toMatch(/76\s?%/);
    expect(text(row("Livrés en moins de 3 j"))).toContain("à égalité");
    expect(within(row("Livrés au 1er passage")).getByTitle("meilleur").textContent).toMatch(/40\s?%/);
    expect(within(row("Retours rendus en 7 j")).getByTitle("meilleur").textContent).toMatch(/57\s?%/);
  });

  it("draws both carriers' weekly rate on one chart", () => {
    renderCompare();
    const card = screen.getByRole("region", { name: "Taux de livraison par semaine" });
    expect(within(card).getByRole("img", { name: "Taux de livraison par semaine" })).toBeInTheDocument();
  });

  it("compares only the cities both serve with at least 10 finished parcels each, biggest first", () => {
    renderCompare();
    const rows = within(screen.getByRole("region", { name: "Ville par ville" })).getAllByRole("listitem").map((r) => r.getAttribute("aria-label"));
    expect(rows).toEqual(["Benghazi", "Sebha", "Al Bayda", "Koufra"]);
  });

  it("needs two carriers", () => {
    renderCompare({ scorecard: libyaScorecard({ carriers: [tripoli()] }) });
    expect(screen.getByText("Il faut au moins deux transporteurs actifs pour comparer.")).toBeInTheDocument();
  });
});
