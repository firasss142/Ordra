import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { tripoli, LY } from "@/test/helpers/scorecardFixture";
import type { ScorecardParcel } from "@/lib/carriers/scorecard/types";

const parcels: ScorecardParcel[] = [
  { order_id: "o1", tracking_number: "1593038", city: "بنغازي", since: "2026-09-25T10:00:00Z", days: 8.1, picked: true, stuck: true,
    darb_status: "delayed", order_status: "delivery_delayed", remark: "لا يرد" },
  { order_id: "o2", tracking_number: "1597630", city: "طرابلس", since: "2026-09-26T10:00:00Z", days: 7.1, picked: false, stuck: false,
    darb_status: "pending", order_status: "uploaded", remark: null },
];
const hook = vi.fn();
vi.mock("@/hooks/useCarrierScorecard", () => ({ useScorecardParcels: (...a: unknown[]) => hook(...a) }));

import { ParcelDrawer } from "../ParcelDrawer";

function renderDrawer(kind: "late" | "returns" | "cities" | "dormant", onCopy = vi.fn()) {
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <ParcelDrawer kind={kind} marketId={LY} carrier={tripoli()} color="#1F5FBF" locale="fr"
        returnsBenchHref="/fr/warehouse/returns" onClose={vi.fn()} onCopy={onCopy} />
    </NextIntlClientProvider>,
  );
  return onCopy;
}

beforeEach(() => hook.mockReturnValue({ parcels, isLoading: false, error: null }));

describe("ParcelDrawer — the parcels behind a number", () => {
  it("lists the late parcels oldest first, says which are stuck, in French", () => {
    renderDrawer("late");
    expect(hook).toHaveBeenCalledWith(LY, tripoli().id, "late");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("11 colis en retard · Tripoli")).toBeInTheDocument();
    const rows = within(dialog).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toContain("1593038");
    expect(rows[0].textContent).toContain("bloqué");
    expect(rows[0].textContent).toContain("Benghazi");
    expect(rows[0].textContent).toMatch(/8\s?j/);
    expect(rows[0].textContent).toContain("Reporté");
    expect(rows[1].textContent).toContain("Réservé, pas encore ramassé");
  });

  it("copies the tracking numbers for the carrier", () => {
    const onCopy = renderDrawer("late");
    fireEvent.click(screen.getByRole("button", { name: "Copier pour Darb" }));
    expect(onCopy).toHaveBeenCalledWith(["1593038", "1597630"]);
  });

  it("lists returns with the day they were handed back, and leads to the returns bench", () => {
    renderDrawer("returns");
    expect(hook).toHaveBeenCalledWith(LY, tripoli().id, "returns");
    expect(screen.getByText("444 retours à scanner · Tripoli")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Rendu le" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ouvrir le banc Retours/ })).toHaveAttribute("href", "/fr/warehouse/returns");
  });

  it("lists every city from the scorecard itself, without a fetch", () => {
    renderDrawer("cities");
    expect(hook).toHaveBeenCalledWith(LY, tripoli().id, null);
    expect(screen.getByText("Toutes les villes · Tripoli")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(1 + tripoli().cities.length);
    expect(screen.getByText("Koufra")).toBeInTheDocument();
  });
});
